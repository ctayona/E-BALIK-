"""Offline Event Smart Tag contracts. Persistence/locking is exercised by the SQL suite."""
import io
import json
import os
from PIL import Image
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4
from flask import Flask

from app.utils.event_tags import EventTags
from app.utils.events import EventError
from Users.Backend.events.routes import event_desk_bp
from Admin.Backend.events.routes import events_bp


class EventSmartTagTests(unittest.TestCase):
    def setUp(self):
        self.tags=EventTags(MagicMock())
        self.actor,self.event,self.code,self.key,self.allocation=[str(uuid4()) for _ in range(5)]
        self.body=dict(event_id=self.event,code=self.code,request_id=self.key,allocation_id=self.allocation,
                       version=1,item_name='Water bottle',description='White and blue bottle')
        self.tags.db.get_user_by_account_id.return_value={'verification_status':'verified','email':'test@example.invalid'}
        self.tags.one=MagicMock(return_value={})
        self.tags.scan=MagicMock(return_value=dict(event_id=self.event,allocation_id=self.allocation,version=1))
        self.bucket=self.tags.client.storage.from_.return_value
        self.photo=object()

    def test_flags_off_and_missing_receipt_fail_closed(self):
        with patch.dict(os.environ,{'EVENT_SMART_TAGS_ENABLED':'false','EVENT_SMART_TAGS_RECOVERY_ONLY':'false'}):
            self.assertEqual(self.tags.mode(),'off')
            self.tags.client.table.assert_not_called()
        self.tags.rows=MagicMock(return_value=[])
        with patch.dict(os.environ,{'EVENT_SMART_TAGS_ENABLED':'true'}):
            with self.assertRaises(EventError): self.tags.require()
        self.tags.rows.return_value=[{'name':'20261124_event_smart_tags'}]
        with patch.dict(os.environ,{'EVENT_SMART_TAGS_RECOVERY_ONLY':'true'}):
            self.assertEqual(self.tags.require(),'recovery')
            with self.assertRaises(EventError): self.tags.require(new=True)

    def test_photo_validation_and_ambiguous_commit(self):
        with patch.object(self.tags,'require'), patch('app.utils.event_tags.normalize_artwork',return_value=b'WEBP'):
            with self.assertRaises(EventError): self.tags.register(self.actor,self.body,None)
            self.bucket.upload.assert_not_called()
            with patch.object(self.tags,'rpc',side_effect=EventError('Conflict')):
                with self.assertRaises(EventError): self.tags.register(self.actor,self.body,self.photo)
            self.bucket.remove.assert_called_once()
            self.bucket.reset_mock()
            with patch.object(self.tags,'rpc',side_effect=TimeoutError):
                with self.assertRaises(TimeoutError): self.tags.register(self.actor,self.body,self.photo)
            self.bucket.remove.assert_not_called()
            self.bucket.upload.side_effect=ValueError('Unavailable')
            with patch.object(self.tags,'rpc') as rpc:
                with self.assertRaises(ValueError): self.tags.register(self.actor,self.body,self.photo)
                rpc.assert_not_called()

    def test_replay_and_stale_scan_do_not_upload(self):
        with patch.object(self.tags,'require'):
            self.tags.one.return_value={'registration_id':self.key}
            self.assertTrue(self.tags.register(self.actor,self.body,None)['replay'])
            self.tags.one.return_value={}
            with self.assertRaises(EventError): self.tags.register(self.actor,{**self.body,'version':2},self.photo)
            self.bucket.upload.assert_not_called()

    def test_private_dto_and_recipient(self):
        row=dict(self.body,registration_id=self.key,status='held',owner_id=self.actor,storage_position='Shelf 2',
                 attempts=0,pin_at=datetime.now(timezone.utc).isoformat(),pin_cipher='opaque',pin_hash='hidden')
        with patch('app.utils.event_tags.CryptoService.decrypt',return_value='PRIVATE'):
            owner=self.tags.view(row,True)
            self.assertNotIn('storage',owner)
            self.assertEqual(owner['pin'],'PRIVATE')
            self.assertNotIn('pin',self.tags.view(row))
            self.assertNotIn('pin_hash',owner)
        self.tags.db.create_user_notification.side_effect=RuntimeError('Offline')
        with patch('app.utils.email_service.send_reference_email_best_effort',return_value=False) as mail:
            self.assertEqual(self.tags.notify(row,'receive'),dict(notified=False,emailed=False))
            self.assertEqual(mail.call_args.kwargs['cta_path'],'/event-items/'+self.key)
            for secret in ('Shelf 2','opaque','PRIVATE',self.code):
                self.assertNotIn(secret,str(mail.call_args))

    def test_attendee_cannot_read_other_sessions_or_media(self):
        self.tags.one.return_value=dict(owner_id=self.actor,event_id=self.event)
        with patch.object(self.tags,'require'),patch.object(self.tags,'staff',side_effect=EventError('Denied',403)):
            with self.assertRaises(EventError): self.tags.photo(str(uuid4()),self.key)
            self.bucket.download.assert_not_called()

    def test_multipart_route_normalizes_camera_bytes_before_atomic_save(self):
        from Users.Backend.events import routes
        from test_event_reports import fixture, USER
        auth_fixture=SimpleNamespace()
        fixture(auth_fixture)
        app=Flask(__name__)
        app.config.update(EVENTS_FOUNDATION_ENABLED=True,SUPABASE_URL='https://example.invalid',SUPABASE_SERVICE_KEY='fixture')
        app.register_blueprint(event_desk_bp,url_prefix='/api/events')
        raw=io.BytesIO()
        Image.new('RGB',(20,20),'blue').save(raw,format='PNG')
        raw.seek(0)
        with patch.object(routes,'get_db',return_value=auth_fixture.db), patch.object(routes.JWTService,'verify_token',return_value={'account_id':USER,'iat':datetime.now(timezone.utc).timestamp()}), patch.object(routes,'EventTags',return_value=self.tags), patch.object(self.tags,'require'), patch.object(self.tags,'rpc',return_value={'registration_id':self.key}) as saved:
            response=app.test_client().post('/api/events/event-tags/register',data={'payload':json.dumps(self.body),'photo':(raw,'camera.png')},headers={'Authorization':'Bearer fixture'})
            self.assertEqual(response.status_code,200,response.json)
            self.assertEqual(self.bucket.upload.call_args.args[1][8:12],b'WEBP')
            self.assertEqual(saved.call_args.args[0],USER)
            self.assertEqual(response.json['registration_id'],self.key)

    def test_history_filters_owner_even_after_the_same_code_is_reused(self):
        from test_event_reports import fixture, USER, OTHER, EVENT
        records=SimpleNamespace()
        fixture(records)
        tag=EventTags(records.db)
        common=dict(event_id=EVENT,code=self.code,status='collected',created_at=datetime.now(timezone.utc).isoformat())
        records.store['event_tag_registrations']=[dict(common,owner_id=actor,registration_id=str(uuid4()),item_name=name) for actor,name in [(USER,'Bottle'),(OTHER,'Umbrella')]]
        with patch.object(tag,'require'):
            rows=tag.listing(USER,'mine',0,event=EVENT)['rows']
            self.assertEqual([r['item_name'] for r in rows],['Bottle'])
            self.assertNotIn('owner_id',rows[0])
            self.assertNotIn('pin',rows[0])
            self.assertTrue(rows[0]['receipt'].startswith('ETS-'))

    def test_permanent_qr_print_origin(self):
        self.tags.one.return_value={'code':self.code}
        with patch.object(self.tags,'require'), patch('app.utils.event_tags.event_origin',return_value=('https://campus.example',True,'')), patch('app.utils.event_tags.entry_qr',return_value=b'PNG') as qr:
            self.assertEqual(self.tags.qr(self.code),b'PNG')
            qr.assert_called_once_with('https://campus.example/event-tag/'+self.code)
        with patch.object(self.tags,'require'), patch('app.utils.event_tags.event_origin',return_value=('http://localhost',False,'Preview only')):
            with self.assertRaises(EventError): self.tags.qr(self.code)

    def test_normal_entry_points_off_and_private(self):
        app=Flask(__name__)
        app.register_blueprint(event_desk_bp,url_prefix='/api/events')
        app.register_blueprint(events_bp,url_prefix='/api/admin')
        client=app.test_client()
        for url in ('/api/events/event-tags/items','/api/admin/events/event-tags/inventory','/api/events/event-tags/scan/'+self.code):
            response=client.get(url)
            self.assertEqual(response.status_code,503)
            self.assertEqual(response.headers['Cache-Control'],'no-store')
        app.config['EVENTS_FOUNDATION_ENABLED']=True
        self.assertIn(client.get('/api/events/event-tags/items').status_code,(401,403))
