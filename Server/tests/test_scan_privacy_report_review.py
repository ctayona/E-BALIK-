"""Isolated privacy, recipient authorization and publication-gating regressions."""
import os
import unittest
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from unittest.mock import MagicMock,patch
from uuid import uuid4
from flask import Flask
from app.utils import tag_scans,report_publication as pub
from app.utils.smart_tags import TagError
from Admin.Backend.report_publication import routes as reviews
from Admin.Backend.activity_logs import routes as activity


class ScanPrivacyTests(unittest.TestCase):
    def test_capability_diagnostics_are_read_only(self):
        from Users.Backend.smart_tags import routes
        service=self.service();app=Flask(__name__);app.register_blueprint(routes.smart_tags_bp,url_prefix='/api/tags')
        with patch.object(routes,'_service',return_value=service),patch.object(tag_scans,'status',return_value=dict(available=True,reason='ready')):
            response=app.test_client().get('/api/tags/capabilities')
        self.assertEqual(response.status_code,200);self.assertEqual(response.get_json()['scan_logging']['reason'],'ready')
        service.public_view.assert_not_called();service.client.rpc.assert_not_called()

    def test_cors_accepts_private_receipt_headers_for_deployed_tag_page(self):
        from app import create_app
        # Keep the real factory/CORS configuration without registering shared global blueprints again.
        with patch('app.utils.supabase_db.get_db',return_value=MagicMock()),patch('app.blueprints.register_blueprints'),patch('app.utils.scheduler.start_scheduler'):
            app=create_app('testing')
        app.add_url_rule('/api/tags/ABCDEFGHJK23',view_func=lambda: {'tag_id':'ABCDEFGHJK23'})
        origin=app.config['CORS_ORIGINS'][0]
        response=app.test_client().options('/api/tags/ABCDEFGHJK23',headers={
            'Origin':origin,'Access-Control-Request-Method':'GET',
            'Access-Control-Request-Headers':'X-Tag-Scan-Id,X-Tag-Scan-Token'})
        allowed=response.headers.get('Access-Control-Allow-Headers','').lower()
        self.assertEqual(response.status_code,200)
        self.assertIn('x-tag-scan-id',allowed);self.assertIn('x-tag-scan-token',allowed)

    def test_logging_defaults_to_installed_schema_but_respects_explicit_suspension(self):
        with patch.dict(os.environ,{},clear=True),patch.object(tag_scans,'installed',return_value=True):
            self.assertTrue(tag_scans.enabled(MagicMock()))
        with patch.dict(os.environ,SMART_TAG_SCAN_LOGGING_ENABLED='false'),patch.object(tag_scans,'installed') as migration:
            self.assertEqual(tag_scans.status(MagicMock())['reason'],'disabled_by_configuration')
            migration.assert_not_called()
        with patch.dict(os.environ,SMART_TAG_SCAN_LOGGING_ENABLED='true'),patch.object(tag_scans,'installed',return_value=False):
            self.assertFalse(tag_scans.enabled(MagicMock()))

    def test_tag_open_records_metadata_and_returns_receipt_without_gps(self):
        from Users.Backend.smart_tags import routes
        service=self.service();service.public_view.return_value=dict(tag_id='ABCDEFGHJK23',status='active',contact={'name':'Visible owner'})
        service.client.rpc.return_value.execute.return_value.data={'scan_id':'saved','scanned_at':'2026-11-25T02:00:00Z'}
        app=Flask(__name__);app.register_blueprint(routes.smart_tags_bp,url_prefix='/api/tags')
        nonce=self.body()
        with patch.object(routes,'_service',return_value=service),patch.object(routes,'_optional_account_id',return_value=None),patch.object(routes.rate_limit,'allow',return_value=True),patch.object(routes.tag_recovery,'enabled',return_value=False),patch.object(tag_scans,'enabled',return_value=True):
            response=app.test_client().get('/api/tags/ABCDEFGHJK23',headers={'X-Tag-Scan-Id':nonce['scan_id'],'X-Tag-Scan-Token':nonce['token']})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.get_json()['scan_receipt']['scan_id'],nonce['scan_id'])
        args=service.client.rpc.call_args.args[1]
        self.assertEqual(args['p_action'],'record');self.assertEqual(args['p_data'],{})
        self.assertNotIn('latitude',args);self.assertEqual(args['p_scan'],nonce['scan_id'])

    def test_failed_recording_preserves_recovery_and_does_not_claim_a_saved_receipt(self):
        from Users.Backend.smart_tags import routes
        service=self.service();service.public_view.return_value=dict(tag_id='ABCDEFGHJK23',status='active',contact={'name':'Visible owner'})
        app=Flask(__name__);app.register_blueprint(routes.smart_tags_bp,url_prefix='/api/tags')
        with patch.object(routes,'_service',return_value=service),patch.object(routes,'_optional_account_id',return_value=None),patch.object(routes.rate_limit,'allow',return_value=True),patch.object(routes.tag_recovery,'enabled',return_value=False),patch.object(tag_scans,'enabled',return_value=True),patch.object(tag_scans,'record_open',side_effect=RuntimeError('offline')):
            response=app.test_client().get('/api/tags/ABCDEFGHJK23')
        self.assertEqual(response.status_code,200);self.assertTrue(response.get_json()['scan_recording_failed'])
        self.assertNotIn('scan_receipt',response.get_json())

    def service(self):
        service=MagicMock()
        service.client.rpc.return_value.execute.return_value.data={'scan_id':'saved'}
        return service

    def body(self,**extra):
        return dict(scan_id=str(uuid4()),token='opaque-receipt-'*4,**extra)

    def test_page_open_sends_no_scanner_identity_or_location(self):
        service=self.service()
        with patch.object(tag_scans,'enabled',return_value=True):
            tag_scans.command(service,'ABCDEFGHJK23',self.body(),'record')
        name,args=service.client.rpc.call_args.args
        self.assertEqual(name,'smart_tag_scan_command')
        self.assertEqual(args['p_data'],{})
        self.assertEqual(len(args['p_hash']),64)
        self.assertNotIn('token',args)

    def test_sharing_rejects_implicit_consent_and_unexpected_fields(self):
        service=self.service()
        with patch.object(tag_scans,'enabled',return_value=True):
            for changes in ({},{'admin_consent':'true','owner_consent':False},
                            {'admin_consent':False,'owner_consent':False}, {'ip_address':'not-collected'}):
                with self.subTest(changes=changes),self.assertRaises(TagError):
                    tag_scans.command(service,'ABCDEFGHJK23',self.body(**changes),'share')
        service.client.rpc.assert_not_called()

    def test_area_fallback_keeps_owner_sharing_separate(self):
        service=self.service()
        body=self.body(admin_consent=True,owner_consent=False,consent_version='scan-v1',venue='Gymnasium',point=None)
        with patch.object(tag_scans,'enabled',return_value=True),patch.object(tag_scans,'available',return_value=['Gymnasium']):
            tag_scans.command(service,'ABCDEFGHJK23',body,'share')
        data=service.client.rpc.call_args.args[1]['p_data']
        self.assertTrue(data['admin_consent']);self.assertFalse(data['owner_consent']);self.assertIsNone(data['point'])

    def test_gps_is_validated_and_never_silently_substituted(self):
        service=self.service()
        body=self.body(admin_consent=True,owner_consent=False,consent_version='scan-v1',venue='',point={
            'latitude':999,'longitude':121,'accuracy':5,'captured_at':datetime.now(timezone.utc).isoformat()})
        with patch.object(tag_scans,'enabled',return_value=True),self.assertRaises(TagError):
            tag_scans.command(service,'ABCDEFGHJK23',body,'share')
        service.client.rpc.assert_not_called()

    def test_each_recipient_gets_only_consented_live_location(self):
        row=dict(scan_id='visit',tag_id='tag',admin_consent=False,owner_consent=True,venue='Library',
            latitude=14.5,longitude=121,accuracy=5,token_hash='secret',owner_id='private',
            location_expires_at=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat())
        self.assertNotIn('latitude',tag_scans.sanitize(row,'admin'))
        shared=tag_scans.sanitize(row,'owner')
        self.assertEqual(shared['latitude'],14.5);self.assertNotIn('token_hash',shared);self.assertNotIn('owner_id',shared)
        for changes in [dict(resolved_at='now'),dict(withdrawn_at='now'),dict(location_expires_at='2000-01-01T00:00:00Z')]:
            self.assertNotIn('latitude',tag_scans.sanitize({**row,**changes},'owner'))

    def test_previous_owner_cannot_read_later_scan_sessions(self):
        service=self.service();service._get.return_value={'owner_account_id':'new-owner'}
        with patch.object(tag_scans,'enabled',return_value=True),self.assertRaises(TagError):
            tag_scans.list_scans(service,tag='ABCDEFGHJK23',owner='previous-owner')

    def test_receipt_failure_does_not_include_precise_location(self):
        service=self.service();service.client.rpc.side_effect=RuntimeError('14.5000 121.0000')
        with patch.object(tag_scans,'enabled',return_value=True),self.assertRaises(TagError) as caught:
            tag_scans.command(service,'ABCDEFGHJK23',self.body(),'withdraw')
        self.assertNotIn('121.0000',caught.exception.message)

    def test_logging_outage_never_blocks_basic_recovery_information(self):
        from Users.Backend.smart_tags import routes
        service=self.service();service.public_view.return_value=dict(tag_id='ABCDEFGHJK23',status='active',contact={'name':'Visible owner'})
        app=Flask(__name__);app.register_blueprint(routes.smart_tags_bp,url_prefix='/api/tags')
        with patch.object(routes,'_service',return_value=service),patch.object(routes,'_optional_account_id',return_value=None),patch.object(routes.rate_limit,'allow',return_value=True),patch.object(routes.tag_recovery,'enabled',return_value=False),patch.object(tag_scans,'enabled',side_effect=RuntimeError('offline metadata')):
            reply=app.test_client().get('/api/tags/ABCDEFGHJK23')
        self.assertEqual(reply.status_code,200);self.assertEqual(reply.get_json()['contact']['name'],'Visible owner')
        self.assertFalse(reply.get_json()['scan_logging'])


class ReportPublicationTests(unittest.TestCase):
    def test_combined_queue_pagination_is_stable_when_timestamps_tie(self):
        from uuid import UUID
        items=[dict(item_id=str(UUID(int=i)),created_at='2026-11-25T00:00:00Z',publication_state='pending',archived_at=None,
                    item_name='Fixture',category='Others',fpost_id='FP'+str(i)) for i in range(1,131)]
        class Query:
            def __init__(self,rows):self.rows=list(rows);self.sorts=[];self.maximum=None
            def select(self,*args):return self
            def eq(self,key,value):self.rows=[r for r in self.rows if r.get(key)==value];return self
            def is_(self,key,value):self.rows=[r for r in self.rows if r.get(key) is None];return self
            def order(self,key,desc=False):self.sorts.append((key,desc));return self
            def limit(self,value):self.maximum=value;return self
            def execute(self):
                for key,desc in reversed(self.sorts):self.rows.sort(key=lambda r:r[key],reverse=desc)
                return SimpleNamespace(data=self.rows[:self.maximum])
        db=MagicMock();db.client.table.side_effect=lambda table:Query(items[:65] if table=='found_items' else items[65:])
        with patch.object(pub,'installed',return_value=True):
            pages=[pub.list_reports(db,'all','pending','','',offset)['reports'] for offset in (0,50,100)]
        ids=[r['item_id'] for page in pages for r in page]
        self.assertEqual(len(ids),130);self.assertEqual(len(set(ids)),130);self.assertEqual(ids,sorted(ids,reverse=True))

    def test_public_query_filters_pending_and_archived_reports(self):
        client,query=MagicMock(),MagicMock()
        with patch.object(pub,'installed',return_value=True):
            pub.public_query(client,query)
        query.eq.assert_called_once_with('publication_state','approved')
        query.eq.return_value.is_.assert_called_once_with('archived_at','null')

    def test_legacy_mode_is_unchanged_but_enabled_setup_failure_is_closed(self):
        client,query=MagicMock(),MagicMock()
        with patch.object(pub,'installed',return_value=False),patch.dict(os.environ,REPORT_REVIEW_ENABLED='false'):
            self.assertIs(pub.public_query(client,query),query);self.assertEqual(pub.submission(client),{})
        with patch.object(pub,'installed',return_value=False),patch.dict(os.environ,REPORT_REVIEW_ENABLED='true'),self.assertRaises(RuntimeError):
            pub.submission(client)

    def test_receipt_detection_never_treats_a_mock_as_applied_migration(self):
        self.assertFalse(pub.installed(MagicMock()))
        client=MagicMock();client.table.side_effect=RuntimeError('offline')
        with patch.dict(os.environ,REPORT_REVIEW_ENABLED='true'),self.assertRaises(RuntimeError):pub.installed(client)

    def test_rejected_review_requires_reason_before_writing(self):
        db=MagicMock()
        with patch.object(pub,'installed',return_value=True),self.assertRaises(ValueError):
            pub.review(db,{'account_id':str(uuid4())},'found',str(uuid4()),dict(state='rejected',version=1,note='no',request_id=str(uuid4())))
        db.client.rpc.assert_not_called()

    def test_replayed_review_does_not_duplicate_notifications(self):
        db=MagicMock();db.client.rpc.return_value.execute.return_value.data={'replayed':True,'state':'approved'}
        with patch.object(pub,'installed',return_value=True):
            pub.review(db,{'account_id':str(uuid4())},'missing',str(uuid4()),dict(state='approved',version=1,note='',request_id=str(uuid4())))
        db.create_user_notification.assert_not_called()

    def test_guards_cannot_access_review_or_scan_logs(self):
        for module,blueprint,path in [(reviews,reviews.report_publication_bp,'/report-publication'),(activity,activity.activity_logs_bp,'/tag-scan-activity')]:
            app=Flask(__name__);app.register_blueprint(blueprint,url_prefix='/api/admin')
            with patch.object(module,'_require_admin',side_effect=PermissionError('Administrator required')),patch.object(module,'get_db') as db:
                self.assertEqual(app.test_client().get('/api/admin'+path).status_code,403)
                self.assertEqual(app.test_client().post('/api/admin'+path,json={}).status_code,403)
                db.assert_not_called()
