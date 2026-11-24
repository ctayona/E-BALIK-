"""Isolated regression coverage for rental capability, receipt and finance adapters."""
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from uuid import uuid4
from types import SimpleNamespace

from test_income import make_db, ADMIN, OWNER
from app.utils.event_rentals import EventRentals, MIGRATION
from app.utils.income import IncomeError, IncomeService
from app.utils.payments import PaymentDesk
from app.utils import receipts


class RentalTests(unittest.TestCase):
    def test_ledger_pages_past_the_server_row_limit(self):
        table = MagicMock()
        for name in ('select', 'order', 'limit', 'range'):
            getattr(table, name).return_value = table
        table.execute.side_effect = [SimpleNamespace(data=[{'entry_id': i} for i in range(1000)], count=1001),
                                     SimpleNamespace(data=[{'entry_id': 1000}], count=1001)]
        db = SimpleNamespace(client=SimpleNamespace(table=lambda name: table))
        rows = IncomeService(db)._rows(None, None)
        self.assertEqual(len(rows), 1001)
        table.range.assert_called_once_with(1000, 1000)

    def fixture(self):
        booking, event = str(uuid4()), str(uuid4())
        store = dict(migration_log=[dict(name=MIGRATION)], event_rental_bookings=[
            dict(booking_id=booking, event_id=event, status='awaiting_payment', version=1,
                 payer_id=OWNER, amount='500.00', quote=dict(event_name='Campus night'))],
            event_workspaces=[dict(event_id=event, status='draft', deleted_at=None)])
        db = make_db(store)
        db.get_user_by_account_id.return_value = dict(account_id=ADMIN, access_level='super_admin', is_active=True)
        db.get_user_by_account_id.side_effect = None
        return db, store, booking

    def test_disabled_or_missing_schema_rejects_writes(self):
        db, store, booking = self.fixture()
        with patch.dict(os.environ, EVENT_RENTALS_ENABLED='false'):
            with self.assertRaises(IncomeError):
                EventRentals(db).record(booking)
        store['migration_log'] = []
        with patch.dict(os.environ, EVENT_RENTALS_ENABLED='true'):
            with self.assertRaises(IncomeError):
                EventRentals(db).command(ADMIN, 'book', {})
        self.assertFalse(store.get('income_ledger'))

    def test_payment_reads_server_quote_and_rejects_stale_amount_before_writing(self):
        db, store, booking = self.fixture()
        with patch.dict(os.environ, EVENT_RENTALS_ENABLED='true'):
            self.assertEqual(str(PaymentDesk(db)._record('event_rental', booking)['amount']), '500.00')
            with self.assertRaises(IncomeError):
                PaymentDesk(db).confirm('event_rental', booking, 'cash', '', '', '1', ADMIN)
            self.assertFalse(store.get('income_ledger'))

    def test_ordinary_admin_cannot_confirm_rental_payment(self):
        db, store, booking = self.fixture()
        db.get_user_by_account_id.return_value['access_level'] = 'admin'
        with patch.dict(os.environ, EVENT_RENTALS_ENABLED='true'), self.assertRaises(IncomeError) as caught:
            PaymentDesk(db).confirm('event_rental', booking, 'cash', '', '', '500', ADMIN)
        self.assertEqual(caught.exception.status, 403)
        self.assertFalse(store.get('income_ledger'))

    def test_refund_requires_mfa_and_receipt_reflects_ledger_reversal(self):
        db, store, booking = self.fixture()
        store['event_rental_bookings'][0]['status'] = 'paid'
        sale = dict(entry_id=str(uuid4()), source='event_rental', source_ref=booking, kind='sale',
                    amount='500.00', received_at=datetime.now(timezone.utc).isoformat(), payer_account_id=OWNER)
        sale['receipt_no'] = receipts.payment_number('event_rental', booking, None)
        store['income_ledger'] = [sale]
        with patch.dict(os.environ, EVENT_RENTALS_ENABLED='true'), self.assertRaises(IncomeError):
            EventRentals(db).reverse(sale, 'Organizer requested cancellation', ADMIN, None)
        receipt = receipts.receipt_for_payment(db, sale['entry_id'])
        self.assertIn('-EV-', receipt['receipt_no'])
        self.assertFalse(receipt['reversed'])
        with patch.object(receipts, '_code', return_value='ABCDE-FGHJK'):
            self.assertTrue(receipts.verify(db, sale['receipt_no'], 'ABCDEFGHJK')['valid'])
        store['income_ledger'].append(dict(kind='refund', receipt_no=sale['receipt_no'], amount='-500'))
        self.assertTrue(receipts.receipt_for_payment(db, sale['entry_id'])['reversed'])

    def test_manual_refund_cannot_invalidate_a_payment_receipt(self):
        db, store, booking = self.fixture()
        with self.assertRaises(IncomeError):
            IncomeService(db).record_manual(dict(kind='refund', source='smart_tag', amount='10',
                description='Partial refund', notes='Small adjustment only', receipt_no='PR-existing'), ADMIN,
                before_commit=lambda: self.fail('MFA must follow input validation'))
        self.assertFalse(store.get('income_ledger'))

    def test_rental_entries_are_categorized_in_summary_and_export(self):
        from memdb import MemClient
        db, store, booking = self.fixture()
        store['income_ledger'] = [dict(entry_id=str(uuid4()), source='event_rental', kind='sale',
            source_ref=booking, amount='500', description='Rental package',
            received_at=datetime.now(timezone.utc).isoformat(), method='cash')]
        db.client = MemClient(store)
        summary = IncomeService(db).summary()
        self.assertEqual(summary['by_source']['event_rental'], 500.0)
        self.assertEqual(summary['total'], 500.0)
        self.assertIn('Event rentals', IncomeService(db).csv_export(source='event_rental'))
        from app.utils.monthly_report import _figures
        month = datetime.now(timezone.utc).date().replace(day=1)
        self.assertEqual(_figures(db, month)['income']['event_rental'], 500.0)

    def test_confirm_adapter_uses_booking_command_and_existing_receipt(self):
        db, store, booking = self.fixture()
        written = str(uuid4())
        def rpc(name, params):
            self.assertEqual(name, 'event_rental_command')
            self.assertEqual(params['p_action'], 'confirm')
            self.assertEqual(params['p_data']['amount'], '500.00')
            self.assertEqual(params['p_data']['version'], 1)
            row = dict(entry_id=written, source='event_rental', source_ref=booking, kind='sale',
                       amount='500.00', received_at=datetime.now(timezone.utc).isoformat(), payer_account_id=OWNER,
                       recorded_by=ADMIN, method='cash', receipt_no=receipts.payment_number('event_rental', booking, None))
            store['income_ledger'] = [row]
            store['event_rental_bookings'][0]['status'] = 'paid'
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=dict(entry_id=written)))
        db.client.rpc = rpc
        with patch.dict(os.environ, EVENT_RENTALS_ENABLED='true'), patch.object(PaymentDesk, '_notify_paid'):
            result = PaymentDesk(db).confirm('event_rental', booking, 'cash', '', '', '500', ADMIN)
            self.assertEqual(result['receipt']['entry_id'], written)
            self.assertLessEqual(len(result['receipt']['receipt_no']), 40)
            self.assertEqual(result['entry']['amount'], '500.00')
            self.assertEqual(store['event_rental_bookings'][0]['status'], 'paid')
            with self.assertRaises(IncomeError):
                PaymentDesk(db).confirm('event_rental', booking, 'cash', '', '', '500', ADMIN)
