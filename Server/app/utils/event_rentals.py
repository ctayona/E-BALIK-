"""Full-payment university bookings. Live writes require the manually installed capability."""
import os
import re
from decimal import Decimal
from uuid import UUID, uuid4

from app.utils.events import EventFoundation
from app.utils.income import IncomeError, money

MIGRATION = '20261124b_event_rentals'


class EventRentals:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    def enabled(self):
        if os.getenv('EVENT_RENTALS_ENABLED', '').lower() != 'true':
            return False
        try:
            return bool(self.client.table('migration_log').select('name').eq('name', MIGRATION).limit(1).execute().data)
        except Exception:
            return False

    def require(self):
        if not self.enabled():
            raise IncomeError('Event billing is unavailable until its migration and configuration are ready.', 503, 'rentals_disabled')

    def rows(self, query):
        return query.execute().data or []

    def workspace(self, identifier):
        self.require()
        EventFoundation(self.db).get(identifier, include_deleted=True)
        bookings = self.rows(self.client.table('event_rental_bookings').select('*').eq('event_id', identifier).order('created_at', desc=True).limit(100))
        return dict(packages=self.rows(self.client.table('event_rental_packages').select('*').order('created_at', desc=True).limit(200)),
                    bookings=bookings)

    def record(self, identifier):
        self.require()
        rows = self.rows(self.client.table('event_rental_bookings').select('*').eq('booking_id', str(UUID(identifier))).limit(1))
        if not rows or rows[0]['status'] != 'awaiting_payment':
            raise IncomeError('This booking is no longer waiting for payment.', 409, 'nothing_owed')
        booking = rows[0]
        event = EventFoundation(self.db).get(booking['event_id'])
        if event['status'] in ('cancelled', 'closed', 'archived'):
            raise IncomeError('This event is no longer payable.', 409)
        return dict(source='event_rental', ref=booking['booking_id'], title=booking['quote']['event_name'],
                    description='Event rental: ' + booking['quote']['event_name'], payer=booking['payer_id'],
                    amount=Decimal(str(booking['amount'])), released=False, booking=booking)

    def command(self, actor, action, data, request_id=None):
        self.require()
        if not isinstance(data, dict) or action not in ('package', 'book', 'confirm', 'cancel', 'refund'):
            raise IncomeError('Choose a valid rental action.')
        if action == 'package':
            for field, low, high in (('name', 3, 100), ('support', 0, 500), ('terms', 8, 1000)):
                value = data.get(field)
                if not isinstance(value, str) or not low <= len(value.strip()) <= high:
                    raise IncomeError('Enter valid package ' + field + '.')
            if not re.fullmatch(r'[0-9]+(?:\.[0-9]{1,2})?', str(data.get('price', ''))):
                raise IncomeError('Enter the package price in pesos with up to two decimal places.')
            money(data['price'], allow_zero=True)
            for field, low, high in (('included_tags', 0, 10000), ('duration_hours', 1, 8760)):
                if type(data.get(field)) is not int or not low <= data[field] <= high:
                    raise IncomeError('Enter a whole-number package ' + field.replace('_', ' ') + '.')
        if action in ('book', 'cancel'):
            note = data.get('note')
            if not isinstance(note, str) or not 8 <= len(note.strip()) <= 1000:
                raise IncomeError('Enter an agreement or cancellation reason of 8–1000 characters.')
        try:
            result = self.client.rpc('event_rental_command', dict(p_actor=actor, p_request=str(UUID(request_id)) if request_id else str(uuid4()),
                                    p_action=action, p_data=data)).execute().data
        except Exception as error:
            # Database error details can contain financial and account information.
            raise IncomeError('Rental action could not be confirmed. Refresh the booking and retry with the same reference.', 409, 'rental_conflict') from error
        return result

    def confirm(self, record, row, actor):
        booking = record['booking']
        result = self.command(actor, 'confirm', dict(booking_id=booking['booking_id'], version=booking['version'],
            amount=str(record['amount']), method=row['method'], reference=row.get('payment_reference'),
            proof_path=row.get('proof_path'), notes=row.get('notes')))
        return self.rows(self.client.table('income_ledger').select('*').eq('entry_id', result['entry_id']).limit(1))[0]

    def reverse(self, sale, reason, actor, before_commit):
        self.require()
        rows = self.rows(self.client.table('event_rental_bookings').select('*').eq('booking_id', sale['source_ref']).limit(1))
        if not rows or rows[0]['status'] != 'paid':
            raise IncomeError('This rental has already been refunded or is not paid.', 409, 'already_reversed')
        if before_commit is None:
            raise IncomeError('Google Authenticator verification required.', 403)
        before_commit()
        booking = rows[0]
        result = self.command(actor, 'refund', dict(booking_id=booking['booking_id'], version=booking['version'], note=reason))
        entry = self.rows(self.client.table('income_ledger').select('*').eq('entry_id', result['entry_id']).limit(1))[0]
        if sale.get('payer_account_id'):
            try:
                self.db.create_user_notification(str(sale['payer_account_id']), 'Event rental payment refunded',
                    'Your event rental payment receipt was reversed. Open My receipts for its current status.',
                    notification_type='receipt', link_label='View receipts', link_page='receipts')
                from app.utils.email_service import send_notice_email_best_effort
                owner = self.db.get_user_by_account_id(str(sale['payer_account_id'])) or {}
                if owner.get('email'):
                    send_notice_email_best_effort(to_email=owner['email'], recipient_name=owner.get('fname') or '',
                        subject='E-Balik event rental refund', summary='Your event rental payment receipt was reversed.',
                        details={'Receipt': sale['receipt_no']}, cta_label='View receipts', cta_path='/')
            except Exception:
                pass
        return dict(entry=entry, receipt_no=sale['receipt_no'])
