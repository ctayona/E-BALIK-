"""Private finder workflow tests use synthetic records, mocked mail and an in-memory client."""
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

from memdb import MemClient
from test_smart_tags import TAG, OWNER, OTHER, tag_row, make_service, user_client, admin_client
from app.utils import campus_catalogue, tag_recovery as recovery
from app.utils.matching import _location
from app.utils.smart_tags import TagError
from Users.Backend.smart_tags import routes


def stamp(days=0):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'SMART_TAG_RECOVERY_ENABLED':'true', 'CAMPUS_VENUES_ENABLED':'true'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.service, self.db, self.store = make_service([tag_row()])
        self.store.update(migration_log=[{'name':recovery.MIGRATION}], campus_venues=[
            {'label':label, 'active':True} for label in ['Library','HPSB','HPSB / 6F','HPSB / 6F / Room 606']])
        self.service.client = self.db.client = MemClient(self.store)
        self.id = str(uuid4())
        self.form = dict(request_id=self.id, venue='HPSB / 6F / Room 606', message='findermessage', contact='findercontact')
        self.saved = dict(state='saved', owner=OWNER, item='Keys', report=self.id)
        self.db.client.rpc_handlers['tag_recovery_submit'] = lambda _: self.saved
        self.point = dict(latitude=14.5, longitude=121.0, accuracy=10.2, captured_at=stamp(), consent_version='finder-v1')

    def test_setup_gates_and_legacy_route(self):
        self.store['migration_log'].clear()
        self.assertFalse(recovery.enabled(self.db.client))
        with self.assertRaises(TagError):
            recovery.submit(self.service,TAG,self.form)
        client, inject = user_client(self.service)
        with inject, patch.object(self.service,'report_found',return_value={'notified':True}) as legacy:
            self.assertEqual(client.post('/api/tags/'+TAG+'/found',json={'message':'old','contact':'address'}).status_code,200)
            legacy.assert_called_once_with(TAG,'old','address')
        with patch.dict(os.environ, {'CAMPUS_VENUES_ENABLED':'false'}):
            self.assertEqual(campus_catalogue.available(self.db.client, events=True),list(campus_catalogue.EVENT_LEGACY))

    def test_consent_age_bounds_invalid_fields(self):
        self.assertIsNone(recovery.point(None))
        self.assertEqual(recovery.point(self.point),self.point)
        for key,bad in [('latitude',91),('latitude',True),('longitude',float('nan')),('accuracy',-1),
                        ('accuracy',float('inf')),('captured_at',stamp(-1)),('captured_at',stamp(1)),('consent_version',None)]:
            with self.subTest(key=key,value=bad), self.assertRaises(TagError):
                recovery.point(dict(self.point,**{key:bad}))
        for extra in [dict(owner_id=OWNER),dict(venue='unknown'),dict(message={}),dict(point=dict(self.point,ip='synthetic'))]:
            with self.assertRaises(TagError):
                recovery.submit(self.service,TAG,{**self.form,**extra})

    def test_private_notifications_and_mail(self):
        with patch('app.utils.email_service.send_reference_email_best_effort',return_value=True) as mail:
            result = recovery.submit(self.service,TAG,dict(self.form,point=self.point))
        self.assertTrue(result['saved'] and result['notified'] and result['emailed'])
        self.assertEqual(mail.call_args.kwargs['details'],{'Item':'Keys','Campus area':'HPSB'})
        self.assertIn('tag='+TAG,mail.call_args.kwargs['cta_path'])
        self.assertEqual(self.db.create_user_notification.call_args.kwargs['link_page'],'my-tags/'+TAG)
        for channel in (mail.call_args,self.db.create_user_notification.call_args,result):
            for sensitive in ('findercontact','findermessage','Room 606','14.5'):
                self.assertNotIn(sensitive,str(channel))

    def test_failed_alerts_duplicate_and_database_error(self):
        self.service._notify_owner = MagicMock(side_effect=RuntimeError())
        self.assertTrue(recovery.submit(self.service,TAG,self.form)['saved'])
        self.service._notify_owner.reset_mock()
        for state in ('duplicate','cooldown'):
            self.saved['state'] = state
            result = recovery.submit(self.service,TAG,self.form)
            self.assertEqual(result['saved'],state=='duplicate')
            self.assertFalse(result['emailed'])
        self.service._notify_owner.assert_not_called()
        with patch.object(self.db.client,'rpc',side_effect=RuntimeError('fixture')):
            with self.assertRaises(TagError) as error:
                recovery.submit(self.service,TAG,self.form)
            self.assertEqual(error.exception.status,503)

    def test_history_is_private_and_enforces_expiry(self):
        report = dict(tag_id=TAG,owner_id=OWNER,created_at=stamp(),received_at=None,returned_at=None,review='clear')
        ids = [str(uuid4()) for _ in range(4)]
        self.store['tag_recovery_reports'] = [dict(report,report_id=k) for k in ids]
        self.store['tag_recovery_reports'][2]['returned_at'] = stamp()
        self.store['tag_recovery_reports'][3]['owner_id'] = OTHER
        self.store['tag_recovery_points'] = [dict(self.point,report_id=k,expires_at=stamp(-1 if i==1 else 1)) for i,k in enumerate(ids)]
        rows = {r['report_id']:r for r in recovery.history(self.service,TAG,OWNER)}
        self.assertTrue(rows[ids[0]]['point'])
        self.assertIsNone(rows[ids[1]]['point'])
        self.assertIsNone(rows[ids[2]]['point'])
        self.assertNotIn(ids[3],rows)
        with self.assertRaises(TagError):
            recovery.history(self.service,TAG,OTHER)
        self.store['smart_tags'][0]['owner_account_id'] = OTHER
        self.assertEqual([r['report_id'] for r in recovery.history(self.service,TAG,OTHER)],[ids[3]])
        with self.assertRaises(TagError):
            recovery.history(self.service,TAG,OWNER)

    def test_flag_requires_current_owner_and_staff_review_is_guarded(self):
        self.store['tag_recovery_reports'] = [dict(tag_id=TAG,owner_id=OWNER,report_id=self.id,review='clear',created_at=stamp(),note='Message')]
        client, inject = user_client(self.service)
        path = f'/api/tags/{TAG}/recovery/{self.id}/flag'
        with inject, patch.object(routes,'_authenticated_account_id',return_value=OTHER):
            self.assertEqual(client.post(path).status_code,404)
        with inject, patch.object(routes,'_authenticated_account_id',return_value=OWNER):
            self.assertEqual(client.post(path).status_code,200)
            self.assertEqual(client.post(path).status_code,409)
        admin, service, access = admin_client(self.service)
        with service, access:
            self.assertEqual(admin.get('/api/admin/smart-tags/recovery/flagged').status_code,200)
            self.assertEqual(admin.post(f'/api/admin/smart-tags/recovery/{self.id}/review').status_code,200)
            self.assertEqual(admin.post('/api/admin/smart-tags/venues',json={'label':'HPSB','active':False}).status_code,403)
        self.assertEqual(self.store['tag_recovery_reports'][0]['review'],'reviewed')

    def test_retirement_and_matching(self):
        self.store['campus_venues'][1]['active'] = False
        self.assertEqual(campus_catalogue.available(self.db.client),['Library'])
        self.assertEqual(_location({'last_location':'Admin Building'},{'location':'Administration Building'})[0],1.0)
        self.assertEqual(_location({'last_location':'HPSB'},{'location':self.form['venue']})[0],0.75)
        self.assertEqual(_location({'last_location':'Academic Building II / 1F / Room 101'},{'location':'Academic Building III / 1F / Room 101'})[0],0.0)

    def test_every_venue_round_trips_through_report_text_validation(self):
        from app.utils.text_guard import clean_field
        for venue in (*campus_catalogue.CATALOGUE['legacy'], *campus_catalogue.PLACES):
            with self.subTest(venue=venue):
                self.assertLessEqual(len(venue), 80)
                self.assertEqual(clean_field(venue, 'place', 'location'), venue)

    def test_admin_added_rooms_are_offered_without_code_changes(self):
        for label in ['New Hall', 'New Hall / 1F', 'New Hall / 1F / Room 100']:
            self.store['campus_venues'].append({'label':label,'active':True})
        self.assertIn('New Hall / 1F / Room 100', campus_catalogue.available(self.db.client,events=True))
        self.store['campus_venues'][-3]['active'] = False
        self.assertNotIn('New Hall / 1F / Room 100', campus_catalogue.available(self.db.client))

    def test_batch_filter_uses_identity_and_composes_with_status(self):
        first, second = str(uuid4()), str(uuid4())
        self.store['smart_tags'] = [
            tag_row(tag_id='FIRSTTAG0001',batch_id=first,batch_label='Same name'),
            tag_row(tag_id='SECONDTAG001',batch_id=second,batch_label='Same name',status='lost'),
            tag_row(tag_id='LEGACYTAG001',batch_id=None,batch_label='Legacy'),
        ]
        rows = self.service.admin_list(batch='id:'+first)['tags']
        self.assertEqual([r['tag_id'] for r in rows],['FIRSTTAG0001'])
        self.assertEqual(self.service.admin_list('lost',batch='id:'+first)['tags'],[])
        self.assertEqual(len(self.service.admin_list('lost',batch='id:'+second)['tags']),1)
        self.assertEqual(len(self.service.admin_list(batch='label:Legacy')['tags']),1)
        with self.assertRaises(TagError):
            self.service.admin_list(batch='id:invalid')
