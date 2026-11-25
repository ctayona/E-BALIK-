"""Exercise actual persistence/review/public readers/notices with an isolated database adapter.

Only PostgreSQL defaults and the review RPC are simulated here; the real RPC's
locking, guards and edit triggers have separate disposable-PostgreSQL coverage.
"""
import unittest
from datetime import datetime,timezone
from uuid import uuid4
from unittest.mock import patch
from memdb import MemClient,MemTable
from app.utils.supabase_db import SupabaseDB
from app.utils import report_publication as publication


class ReportTable(MemTable):
    def execute(self):
        if self.op=='insert' and self.name in ('found_items','missing_items'):
            self.payload={'item_id':str(uuid4()),'created_at':datetime.now(timezone.utc).isoformat(),
                          'publication_version':1,**self.payload}
        return super().execute()


class ReportClient(MemClient):
    def table(self,name):return ReportTable(self,name)


class ReportApprovalJourneyTests(unittest.TestCase):
    def setup_db(self,kind):
        owner,admin=str(uuid4()),str(uuid4())
        store={'migration_log':[{'name':publication.MIGRATION}],'user_notifications':[],
               'found_items':[],'missing_items':[],'report_publication_history':[]}
        client=ReportClient(store)
        db=SupabaseDB.__new__(SupabaseDB);db.client=client
        table='found_items' if kind=='found' else 'missing_items'
        def review_rpc(args):
            previous=next((r for r in store['report_publication_history'] if r['request_id']==args['p_request']),None)
            if previous:return {'state':previous['state'],'replayed':True}
            row=next(r for r in store[table] if r['item_id']==args['p_item'])
            if row['publication_state']!='pending' or row['publication_version']!=args['p_version']:raise ValueError('Stale review')
            row.update(publication_state=args['p_state'],publication_version=args['p_version']+1)
            store['report_publication_history'].append({'request_id':args['p_request'],'state':args['p_state']})
            return {'state':args['p_state'],'replayed':False}
        client.rpc_handlers['report_publication_review']=review_rpc
        payload=dict(account_id=owner,item_name='Fixture bottle',category='Personal Effects',description='A plain blue bottle',
                     publication_state='approved',status='unclaimed' if kind=='found' else 'missing')
        payload.update({'fpost_id':'FP-FIXTURE','location':'Gymnasium','found_date':'2026-11-25','custody_status':'turned_over'} if kind=='found' else
                       {'mpost_id':'MP-FIXTURE','last_location':'Gymnasium','last_seen_date':'2026-11-25'})
        payload.update(dict(fpost_id='FP-TEST',location='Gymnasium',found_date='2026-11-25') if kind=='found' else
                       dict(mpost_id='MP-TEST',last_location='Gymnasium',last_seen_date='2026-11-25'))
        create=db.create_found_item if kind=='found' else db.create_missing_item
        row=create(payload)
        return db,store,row,dict(account_id=admin,email='admin@example.invalid'),owner

    def test_submission_stays_private_until_review_then_publishes_and_notifies_once(self):
        for kind in ('found','missing'):
            with self.subTest(kind=kind):
                db,store,row,actor,owner=self.setup_db(kind)
                self.assertEqual(row['publication_state'],'pending')
                self.assertEqual(row['status'],'unclaimed' if kind=='found' else 'missing')
                public=db.get_public_found_items if kind=='found' else db.get_public_missing_items
                own=db.get_found_items_by_account if kind=='found' else db.get_missing_items_by_account
                self.assertEqual(public(),[])
                self.assertEqual(own(owner)[0]['publication_state'],'pending')
                queue=publication.list_reports(db,'all','pending','','',0)
                self.assertEqual(queue['reports'][0]['item_id'],row['item_id'])
                self.assertEqual(db.get_public_board()['found' if kind=='found' else 'missing'],[])
                self.assertEqual(db.get_unclaimed_found_items_for_matching() if kind=='found' else db.get_missing_items_for_matching(),[])
                self.assertEqual(store['user_notifications'],[])
                body=dict(state='approved',version=1,note='',request_id=str(uuid4()))
                alert='app.utils.match_alerts.alert_for_new_found_item' if kind=='found' else 'app.utils.match_alerts.alert_for_new_missing_report'
                with patch(alert,return_value=0) as matching:
                    publication.review(db,actor,kind,row['item_id'],body)
                    publication.review(db,actor,kind,row['item_id'],body)
                    matching.assert_called_once()
                self.assertEqual(len(public()),1)
                self.assertEqual(own(owner)[0]['publication_state'],'approved')
                self.assertEqual(publication.list_reports(db,'all','pending','','',0)['reports'],[])
                self.assertEqual(len(store['user_notifications']),1)
                notice=store['user_notifications'][0]
                self.assertEqual(notice['user_account_id'],owner)
                self.assertEqual(notice['notification_type'],'report_approval')
                self.assertEqual(notice['found_item_id'] if kind=='found' else notice['missing_report_id'],row['item_id'])
                self.assertEqual(notice['link_page'],'my-reports')

    def test_rejection_stays_unpublished_and_explains_changes_to_the_reporter(self):
        db,store,row,actor,owner=self.setup_db('missing')
        publication.review(db,actor,'missing',row['item_id'],dict(state='rejected',version=1,
            note='Remove identifying details from the description.',request_id=str(uuid4())))
        self.assertEqual(db.get_public_missing_items(),[])
        self.assertEqual(db.get_missing_items_by_account(owner)[0]['publication_state'],'rejected')
        notice=store['user_notifications'][0]
        self.assertEqual(notice['notification_type'],'report_rejection')
        self.assertIn('Remove identifying details',notice['message'])
