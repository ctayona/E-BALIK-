"""
Supabase Database Connection Handler
"""
from supabase import create_client, Client
from typing import Optional, List, Dict, Any
import logging
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote
from uuid import UUID

from app.utils.matching import match_percentage
from app.utils.report_lifecycle import ReportLifecycle
from app.utils import custody_log
from app.utils.archive import flag_archived
from app.utils.paging import fetch_all
from app.utils.crypto_service import CryptoService
from app.utils.claim_status import normalize_claim_status

logger = logging.getLogger(__name__)

# A found report is finished once the item left custody (the same list as report_lifecycle.COMPLETED_FOUND). Shown as "Completed".
FINISHED_FOUND_STATUSES = frozenset({'returned', 'claimed', 'closed', 'collected'})


class SupabaseDB:
    """Supabase database connection and query handler"""
    _legacy_profile_columns = {
        'account_id', 'campus_id', 'fname', 'mname', 'lname', 'email',
        'password_hash', 'user_role', 'created_at', 'last_login_at'
    }
    _auth_profile_columns = {
        'auth_provider', 'google_sub', 'failed_login_attempts', 'locked_until',
        'is_active', 'updated_at', 'verification_status', 'verification_document_type',
        'verification_document_name', 'verification_document_url', 'verification_document_bucket',
        'verification_last_updated', 'verification_uploaded_at'
    }

    def __init__(self, url: str, service_key: str):
        """Initialize Supabase client with service key for admin operations"""
        try:
            self.client: Client = create_client(url, service_key)
            self.supports_profile_auth_fields = self._detect_profile_auth_fields()
            logger.info("✓ Supabase client initialized successfully")
        except Exception as e:
            logger.error(f"✗ Failed to initialize Supabase client: {e}")
            raise

    def _detect_profile_auth_fields(self) -> bool:
        """Check whether the database has the newer auth-related columns."""
        try:
            self.client.table('user_profiles').select(
                'auth_provider,google_sub,failed_login_attempts,locked_until,last_login_at'
            ).limit(1).execute()
            return True
        except Exception:
            return False

    VERIFIED_CATEGORIES = ('Student', 'Faculty', 'Staff', 'Visitor')
    CATEGORY_TO_LEGACY_ROLE = {'Student': 'Student', 'Faculty': 'Faculty', 'Staff': 'Staff', 'Visitor': 'Others'}
    _governance_state = {'ok': None, 'at': 0.0}

    @property
    def supports_governance_fields(self) -> bool:
        """True once 20261006_system_control_verification.sql has added user_category and the suspension columns."""
        state = self._governance_state
        ttl = 300 if state['ok'] else 20
        if state['ok'] is None or time.monotonic() - state['at'] > ttl:
            try:
                self.client.table('user_profiles').select('user_category,suspended_until,suspension_reason,suspended_by').limit(1).execute()
                state['ok'] = True
            except Exception:
                state['ok'] = False
            state['at'] = time.monotonic()
        return bool(state['ok'])

    def _filter_supported_fields(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Drop unsupported keys so writes still work on older schema versions."""
        if not payload:
            return {}

        allowed_keys = self._legacy_profile_columns | ({*self._auth_profile_columns} if self.supports_profile_auth_fields else set())
        return {key: value for key, value in payload.items() if key in allowed_keys}

    def log_user_activity(self, account_id: str, user_name: str, action: str, module: str, target_name: str = None, target_id: str = None, result: str = 'success', metadata: Dict[str, Any] = None) -> Dict[str, Any]:
        """Log a user activity to the user_activity_logs table."""
        try:
            normalized_name = (user_name or '').strip() or 'User'
            log_entry = {
                'account_id': account_id,
                'user_name': normalized_name,
                'action': action,
                'module_name': module,
                'target_name': target_name,
                'target_id': str(target_id) if target_id is not None else None,
                'result': result,
                'metadata': {'table_name': 'user_activity_logs', 'details': metadata or {}},
            }
            response = self.client.table('user_activity_logs').insert(log_entry).execute()
            logger.info(f"✓ Activity logged: {action} by {normalized_name}")
            return response.data[0] if response.data else {}
        except Exception as e:
            logger.warning(f"Unable to log activity: {e}")
            return {}

    def create_user_profile(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a new user profile
        
        Expected keys in user_data:
        - account_id: Unique identifier for account (UUID)
        - campus_id: Student/Employee ID from input
        - fname: First name
        - mname: Middle name (optional)
        - lname: Last name
        - email: University email
        - password_hash: Hashed password
        - user_role: User role (empty initially)
        - auth_provider: 'local' or 'google'
        - google_sub: Google subject id, optional
        - failed_login_attempts: number of recent failed attempts
        - locked_until: UTC timestamp for lockout
        """
        try:
            safe_user_data = self._filter_supported_fields(user_data)
            if not safe_user_data:
                logger.warning("User profile payload was empty after filtering unsupported Supabase columns.")
                return {}
            response = self.client.table('user_profiles').insert(safe_user_data).execute()
            logger.info(f"✓ User profile created: {user_data.get('email')}")
            return response.data[0] if response.data else {}
        except Exception as e:
            logger.error(f"✗ Error creating user profile: {e}")
            raise

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Retrieve user by email"""
        try:
            response = self.client.table('user_profiles').select('*').eq('email', email).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"✗ Error fetching user by email: {e}")
            return None

    def get_user_by_campus_id(self, campus_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve user by the unique campus ID."""
        try:
            response = self.client.table('user_profiles').select('*').eq('campus_id', campus_id).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"✗ Error fetching user by campus ID: {e}")
            return None

    def get_user_by_google_sub(self, google_sub: str) -> Optional[Dict[str, Any]]:
        """Retrieve user by Google subject id"""
        try:
            response = self.client.table('user_profiles').select('*').eq('google_sub', google_sub).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"✗ Error fetching user by google_sub: {e}")
            return None

    def get_user_by_account_id(self, account_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve user by account ID"""
        try:
            response = self.client.table('user_profiles').select('*').eq('account_id', account_id).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"✗ Error fetching user by account_id: {e}")
            return None

    def get_found_item_by_fpost_id(self, fpost_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = self.client.table('found_items').select('*').eq('fpost_id', fpost_id).limit(1).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"✗ Error fetching found item by fpost_id: {e}")
            raise

    def _decrypt_profile_sensitive_fields(self, user: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not user:
            return user
        decrypted = dict(user)
        if decrypted.get('verification_document_name'):
            decrypted['verification_document_name'] = CryptoService.decrypt(decrypted['verification_document_name']) or decrypted['verification_document_name']
        if decrypted.get('verification_document_url'):
            decrypted['verification_document_url'] = CryptoService.decrypt(decrypted['verification_document_url']) or decrypted['verification_document_url']
        return decrypted

    def _decrypt_claim_sensitive_fields(self, claim: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not claim:
            return claim
        decrypted = dict(claim)
        if decrypted.get('claim_reason'):
            decrypted['claim_reason'] = CryptoService.decrypt(decrypted['claim_reason']) or decrypted['claim_reason']
        if decrypted.get('proof_image_url'):
            decrypted['proof_image_url'] = CryptoService.decrypt(decrypted['proof_image_url']) or decrypted['proof_image_url']
        if decrypted.get('identity_document_name'):
            decrypted['identity_document_name'] = CryptoService.decrypt(decrypted['identity_document_name']) or decrypted['identity_document_name']
        return decrypted

    def _legacy_claim_storage_path(self, value: Optional[str], bucket: str) -> Optional[str]:
        if not value:
            return None
        marker = f'/storage/v1/object/public/{bucket}/'
        if marker not in value:
            return None
        return unquote(value.split(marker, 1)[1].split('?', 1)[0])

    def get_claims_by_account(self, account_id: str) -> List[Dict[str, Any]]:
        response = self.client.table('claims').select(
            'claim_id,claim_reference,found_item_id,claimant_account_id,claim_reason,proof_image_url,proof_image_path,identity_document_path,identity_document_type,identity_document_name,status,rejection_reason,created_at,reviewed_at,updated_at,collected_at,found_items(fpost_id,item_name,category,location,found_date,image_url)'
        ).eq('claimant_account_id', account_id).order('created_at', desc=True).execute()
        claims = []
        for row in response.data or []:
            claim = self._decrypt_claim_sensitive_fields(row) or row
            proof_path = claim.pop('proof_image_path', None) or self._legacy_claim_storage_path(claim.get('proof_image_url'), 'claim-proof-images')
            claim.pop('proof_image_url', None)
            claim['proof_image_url'] = self._create_signed_storage_url('claim-proof-images', proof_path)
            identity_path = claim.pop('identity_document_path', None)
            claim['identity_document_url'] = self._create_signed_storage_url('claim-id-documents', identity_path)
            claims.append(claim)
        self._attach_handover_pins(claims)
        return claims

    def _attach_handover_pins(self, claims: List[Dict[str, Any]]) -> None:
        """Give the owner the Handover PIN of each approved claim (decrypted, own claims only). Silent if PINs are not set up yet."""
        approved = [c for c in claims if str(c.get('status') or '') == 'approved_for_pickup' and c.get('claim_id')]
        if not approved:
            return
        try:
            rows = self.client.table('claims').select('claim_id,handover_pin_encrypted').in_('claim_id', [c['claim_id'] for c in approved]).execute().data or []
        except Exception:
            return
        pins = {str(r['claim_id']): r.get('handover_pin_encrypted') for r in rows}
        for claim in approved:
            token = pins.get(str(claim['claim_id']))
            if token:
                try:
                    claim['handover_pin'] = CryptoService.decrypt(token) or None
                except Exception:
                    claim['handover_pin'] = None

    def get_claim_email_context(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Return only stored recipient and item-reference fields needed for claim mail."""
        try:
            response = self.client.table('claims').select(
                'claim_id,claim_reference,claimant_account_id,found_item_id'
            ).eq('claim_id', claim_id).limit(1).execute()
        except Exception:
            response = self.client.table('claims').select(
                'claim_id,claimant_account_id,found_item_id'
            ).eq('claim_id', claim_id).limit(1).execute()
        claim = (response.data or [None])[0]
        if not claim:
            return None

        claimant = self.get_user_by_account_id(str(claim.get('claimant_account_id') or '')) or {}
        found_item = {}
        if claim.get('found_item_id'):
            found_response = self.client.table('found_items').select(
                'fpost_id,item_name'
            ).eq('item_id', claim['found_item_id']).limit(1).execute()
            found_item = (found_response.data or [{}])[0]

        return {
            'email': claimant.get('email') or '',
            'name': f"{claimant.get('fname') or ''} {claimant.get('lname') or ''}".strip() or 'there',
            'claim_reference': claim.get('claim_reference') or claim.get('claim_id'),
            'found_item_reference': found_item.get('fpost_id') or '',
            'item_name': found_item.get('item_name') or 'Found item',
        }

    def get_pending_claim(self, found_item_id: str, account_id: str) -> Optional[Dict[str, Any]]:
        response = self.client.table('claims').select('claim_id').eq('found_item_id', found_item_id).eq('claimant_account_id', account_id).in_('status', ['pending', 'approved_for_pickup']).limit(1).execute()
        return response.data[0] if response.data else None

    def create_claim(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        safe_claim = dict(claim_data)
        if safe_claim.get('claim_reason'):
            safe_claim['claim_reason'] = CryptoService.encrypt(safe_claim['claim_reason'])
        if safe_claim.get('proof_image_url'):
            safe_claim['proof_image_url'] = CryptoService.encrypt(safe_claim['proof_image_url'])
        if safe_claim.get('identity_document_name'):
            safe_claim['identity_document_name'] = CryptoService.encrypt(safe_claim['identity_document_name'])
        try:
            response = self.client.table('claims').insert(safe_claim).execute()
        except Exception as insert_error:
            if 'missing_report_id' not in safe_claim or 'missing_report_id' not in str(insert_error):
                raise
            # Migration 20261015 has not been run yet: the claim is still saved, without the link to the lost report.
            safe_claim.pop('missing_report_id')
            response = self.client.table('claims').insert(safe_claim).execute()
        created = response.data[0] if response.data else {}
        return self._decrypt_claim_sensitive_fields(created) or created

    def find_open_claim(self, found_item_id: str, account_id: str) -> Optional[Dict[str, Any]]:
        """Return an existing pending/approved claim by this account for this found item, if any."""
        response = self.client.table('claims').select('claim_id, claim_reference, status').eq(
            'found_item_id', found_item_id
        ).eq('claimant_account_id', account_id).in_('status', ['pending', 'approved_for_pickup']).limit(1).execute()
        return response.data[0] if response.data else None

    def update_claim_details(self, claim_id: str, claim_reason: str) -> Optional[Dict[str, Any]]:
        """Edit the reason of an open (pending or approved) claim; closed claims stay immutable."""
        response = self.client.table('claims').update({
            'claim_reason': CryptoService.encrypt(claim_reason),
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }).eq('claim_id', claim_id).in_('status', ['pending', 'approved_for_pickup']).execute()
        updated = response.data[0] if response.data else None
        return self._decrypt_claim_sensitive_fields(updated) if updated else None

    def cancel_claim(self, claim_id: str, account_id: str) -> bool:
        response = self.client.table('claims').delete().eq(
            'claim_id', claim_id
        ).eq('claimant_account_id', account_id).eq('status', 'pending').execute()
        return bool(response.data)

    def update_user(self, account_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update user profile, while ignoring fields that do not exist in the live schema."""
        try:
            safe_update_data = self._filter_supported_fields(update_data)
            if not safe_update_data:
                logger.warning(f"Skipping update for account {account_id}: no supported fields available.")
                return {}
            response = self.client.table('user_profiles').update(safe_update_data).eq('account_id', account_id).execute()
            logger.info(f"✓ User profile updated: {account_id}")
            return response.data[0] if response.data else {}
        except Exception as e:
            logger.error(f"✗ Error updating user profile: {e}")
            raise

    def store_otp(self, email: str, otp_code: str, otp_type: str, expires_at: str) -> Dict[str, Any]:
        """
        Store OTP for email verification or password reset
        Encrypts only OTP code with AES-256-GCM (email kept plain for queries)
        
        otp_type: 'registration' or 'password_reset'
        """
        try:
            otp_data = {
                'email': email,  # Keep plain for database queries
                'otp_code': CryptoService.encrypt(otp_code),  # Encrypt the sensitive OTP code
                'otp_type': otp_type,
                'expires_at': expires_at,
                'is_used': False
            }
            response = self.client.table('otp_tokens').insert(otp_data).execute()
            logger.info(f"✓ OTP stored and encrypted for {email}")
            return response.data[0] if response.data else {}
        except Exception as e:
            logger.error(f"✗ Error storing OTP: {e}")
            raise

    def verify_otp(self, email: str, otp_code: str, otp_type: str) -> bool:
        """Verify OTP code (decrypts code and compares with provided code)"""
        try:
            # Query by plain text email and type
            response = self.client.table('otp_tokens').select('*').eq('email', email).eq('otp_type', otp_type).eq('is_used', False).execute()
            
            if not response.data:
                logger.warning(f"✗ Invalid or expired OTP for {email}")
                return False
            
            otp_record = response.data[0]
            
            # Decrypt the stored code and compare with provided code
            decrypted_code = CryptoService.decrypt(otp_record.get('otp_code'))
            
            if decrypted_code == otp_code:
                # Check if expired would be done in business logic
                
                # Mark as used
                self.client.table('otp_tokens').update({'is_used': True}).eq('id', otp_record['id']).execute()
                logger.info(f"✓ OTP verified for {email}")
                return True
            else:
                logger.warning(f"✗ Invalid OTP code for {email}")
                return False
                
        except Exception as e:
            logger.error(f"✗ Error verifying OTP: {e}")
            return False

    def get_otp_by_email(self, email: str, otp_type: str) -> Optional[Dict[str, Any]]:
        """Get OTP record for an email (decrypts the OTP code field)"""
        try:
            # Query by plain text email
            response = self.client.table('otp_tokens').select('*').eq('email', email).eq('otp_type', otp_type).eq('is_used', False).order('created_at', desc=True).limit(1).execute()
            
            if not response.data:
                return None
            
            otp_record = response.data[0]
            
            # Decrypt the OTP code field
            otp_record['otp_code'] = CryptoService.decrypt(otp_record.get('otp_code'))
            
            return otp_record
        except Exception as e:
            logger.error(f"✗ Error fetching OTP: {e}")
            return None

    def store_verification_document(self, account_id: str, document_name: str, document_type: str, document_url: str, document_bucket: str = 'general', verification_status: str = 'pending') -> Dict[str, Any]:
        """Store verification document metadata in the user profile record."""
        try:
            uploaded_at = self._utc_now_iso()
            payload = {
                'verification_document_name': CryptoService.encrypt(document_name),
                'verification_document_type': document_type,
                'verification_document_url': CryptoService.encrypt(document_url),
                'verification_document_bucket': document_bucket,
                'verification_status': verification_status,
                'verification_last_updated': uploaded_at,
                'verification_uploaded_at': uploaded_at,
                'updated_at': uploaded_at,
                'verification_review_note': None,
                'verification_reviewed_at': None,
                'verification_reviewed_by': None,
            }
            response = self.client.table('user_profiles').update(payload).eq('account_id', account_id).execute()
            logger.info(f"✓ Verification document stored for account {account_id}")
            stored = response.data[0] if response.data else {}
            return self._decrypt_profile_sensitive_fields(stored) or stored
        except Exception as e:
            logger.error(f"✗ Error storing verification document: {e}")
            raise

    def list_account_verification_requests(self, limit: int = 200) -> list[Dict[str, Any]]:
        response = self.client.table('user_profiles').select(
            'account_id,campus_id,fname,mname,lname,email,user_role,access_level,verification_status,verification_document_type,verification_document_name,verification_document_url,verification_document_bucket,verification_uploaded_at,verification_review_note'
        ).eq('verification_status', 'pending').order('verification_uploaded_at', desc=True).limit(limit).execute()

        requests = []
        for raw_profile in response.data or []:
            profile = self._decrypt_profile_sensitive_fields(raw_profile) or raw_profile
            document_path = profile.get('verification_document_url')
            bucket = profile.get('verification_document_bucket')
            if not document_path or not bucket:
                continue
            requests.append({
                'account_id': str(profile.get('account_id')),
                'name': f"{profile.get('fname') or ''} {profile.get('mname') or ''} {profile.get('lname') or ''}".strip(),
                'email': profile.get('email') or '',
                'campus_id': profile.get('campus_id') or '',
                'user_role': profile.get('user_role') or 'Others',
                'access_level': profile.get('access_level') or 'user',
                'verification_status': profile.get('verification_status') or 'pending',
                'document_type': profile.get('verification_document_type') or 'Identity document',
                'document_name': profile.get('verification_document_name') or 'Verification document',
                'uploaded_at': profile.get('verification_uploaded_at') or '',
                'review_note': profile.get('verification_review_note') or '',
                'document_url': self._create_signed_storage_url(str(bucket), str(document_path), expires_in=600),
            })
        return requests

    def review_account_verification(
        self,
        account_id: str,
        status: str,
        reviewed_by: str,
        user_category: Optional[str] = None,
        review_note: Optional[str] = None,
    ) -> Dict[str, Any]:
        profile = self.get_user_by_account_id(account_id)
        profile = self._decrypt_profile_sensitive_fields(profile)
        if not profile or profile.get('verification_status') != 'pending':
            raise RuntimeError('Verification request is no longer pending')
        if not profile.get('verification_document_url') or not profile.get('verification_document_name'):
            raise RuntimeError('Verification document is missing')
        if status not in {'verified', 'rejected'}:
            raise ValueError('Verification status must be verified or rejected')

        update = {
            'verification_status': status,
            'verification_review_note': (review_note or '').strip() or None,
            'verification_reviewed_at': self._utc_now_iso(),
            'verification_reviewed_by': reviewed_by,
            'verification_last_updated': self._utc_now_iso(),
            'updated_at': self._utc_now_iso(),
        }
        if status == 'verified':
            if user_category not in self.VERIFIED_CATEGORIES:
                raise ValueError('Choose a role: Student, Faculty, Staff or Visitor')
            if not self.supports_governance_fields:
                raise RuntimeError('Verification roles need the 20261006_system_control_verification.sql migration. Run it in Supabase, then try again.')
            update['user_category'] = user_category
            # Keep the older user_role column in step so existing screens still show a sensible role.
            update['user_role'] = self.CATEGORY_TO_LEGACY_ROLE[user_category]

        response = self.client.table('user_profiles').update(update).eq('account_id', account_id).eq(
            'verification_status', 'pending'
        ).execute()
        if not response.data:
            raise RuntimeError('Verification request is no longer pending')
        return response.data[0]

    def create_found_item(self, item_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a found-item intake record using the canonical found_items columns."""
        try:
            allowed_fields = {
                'account_id', 'fpost_id', 'reporter_account_id', 'reporter_email',
                'reporter_campus_id', 'reporter_name', 'item_name', 'category', 'description',
                'location', 'found_date', 'image_url', 'turnover_location',
                'guard_name_or_id', 'handover_guard_id', 'smart_tag_id', 'custody_status', 'status'
            }
            payload = {key: value for key, value in item_data.items() if key in allowed_fields and value is not None}
            while True:
                try:
                    response = self.client.table('found_items').insert(payload).execute()
                    break
                except Exception as insert_error:
                    # Migrations 20261015 and 20261017 add these columns. Without them the report is still saved, minus the link.
                    missing = next((column for column in ('handover_guard_id', 'smart_tag_id') if column in payload and column in str(insert_error)), None)
                    if not missing:
                        raise
                    payload.pop(missing)
            logger.info(f"✓ Found item created: {payload.get('item_name')}")
            return response.data[0] if response.data else {}
        except Exception as e:
            logger.error(f"✗ Error creating found item: {e}")
            raise

    def update_found_item_by_account(self, fpost_id: str, account_id: str, item_data: Dict[str, Any]) -> Dict[str, Any]:
        allowed_fields = {'item_name', 'category', 'description', 'location', 'found_date'}
        payload = {key: value for key, value in item_data.items() if key in allowed_fields and value is not None}
        response = self.client.table('found_items').update(payload).eq('fpost_id', fpost_id).eq('account_id', account_id).execute()
        return response.data[0] if response.data else {}

    def delete_found_item_by_account(self, fpost_id: str, account_id: str) -> bool:
        response = self.client.table('found_items').delete().eq('fpost_id', fpost_id).eq('account_id', account_id).execute()
        return bool(response.data)

    def get_found_items_by_account(self, account_id: str) -> List[Dict[str, Any]]:
        """Return reports created by one account, newest first."""
        try:
            response = self.client.table('found_items').select('*').eq('account_id', account_id).order('created_at', desc=True).execute()
            return response.data or []
        except Exception as e:
            logger.error(f"✗ Error fetching found items: {e}")
            raise

    def get_unclaimed_found_items_for_matching(self) -> List[Dict[str, Any]]:
        """Return non-private found fields for server-side matching."""
        response = self.client.table('found_items').select(
            'fpost_id,item_name,category,description,location,found_date,image_url,status,created_at'
        ).eq('status', 'unclaimed').order('created_at', desc=True).limit(1000).execute()
        return response.data or []

    def search_found_items(self, category: str = '', location: str = '', found_date: str = '', query: str = '') -> List[Dict[str, Any]]:
        """Return searchable, non-private found reports for matching and discovery."""
        try:
            request = self.client.table('found_items').select(
                'fpost_id,item_name,category,description,location,found_date,image_url,status,created_at'
            ).eq('status', 'unclaimed')
            if category:
                request = request.eq('category', category)
            if location:
                request = request.ilike('location', f'%{location}%')
            if found_date:
                request = request.eq('found_date', found_date)
            if query:
                request = request.or_(f'item_name.ilike.%{query}%,description.ilike.%{query}%')
            response = request.order('created_at', desc=True).limit(100).execute()
            return response.data or []
        except Exception as e:
            logger.error(f"✗ Error searching found items: {e}")
            raise

    def next_fpost_id(self, found_date: str, weekday_code: str) -> str:
        """Generate the next globally unique FP<day number><sequence> identifier."""
        try:
            prefix = f"FP{weekday_code}"
            response = self.client.table('found_items').select('fpost_id').like('fpost_id', f'{prefix}%').execute()
            sequences = []
            for row in response.data or []:
                value = str(row.get('fpost_id') or '')
                if value.startswith(prefix) and value[3:].isdigit():
                    sequences.append(int(value[3:]))
            return f"{prefix}{(max(sequences, default=0) + 1):03d}"
        except Exception as e:
            logger.error(f"✗ Error generating found post ID: {e}")
            raise

    def create_missing_item(self, item_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a missing-item report using the canonical missing_items columns."""
        try:
            allowed_fields = {
                'account_id', 'mpost_id', 'reporter_account_id', 'reporter_email',
                'reporter_campus_id', 'reporter_name', 'item_name', 'category', 'description',
                'distinctive_marks', 'last_location', 'last_seen_date', 'image_url',
                'status'
            }
            payload = {key: value for key, value in item_data.items() if key in allowed_fields and value is not None}
            try:
                response = self.client.table('missing_items').insert(payload).execute()
            except Exception as first_error:
                legacy_fields = {
                    'account_id', 'mpost_id', 'item_name', 'category', 'description',
                    'last_location', 'last_seen_date', 'image_url', 'status'
                }
                legacy_payload = {key: value for key, value in payload.items() if key in legacy_fields}
                logger.warning(f"Missing-item insert with reporter fields failed; retrying compatible payload: {first_error}")
                response = self.client.table('missing_items').insert(legacy_payload).execute()
            logger.info(f"✓ Missing item created: {payload.get('item_name')}")
            return response.data[0] if response.data else {}
        except Exception as e:
            logger.error(f"✗ Error creating missing item: {e}")
            raise

    def update_missing_item_by_account(self, mpost_id: str, account_id: str, item_data: Dict[str, Any]) -> Dict[str, Any]:
        allowed_fields = {'item_name', 'category', 'description', 'distinctive_marks', 'last_location', 'last_seen_date'}
        payload = {key: value for key, value in item_data.items() if key in allowed_fields and value is not None}
        response = self.client.table('missing_items').update(payload).eq('mpost_id', mpost_id).eq('account_id', account_id).execute()
        return response.data[0] if response.data else {}

    def delete_missing_item_by_account(self, mpost_id: str, account_id: str) -> bool:
        response = self.client.table('missing_items').delete().eq('mpost_id', mpost_id).eq('account_id', account_id).execute()
        return bool(response.data)

    def get_missing_items_by_account(self, account_id: str) -> List[Dict[str, Any]]:
        """Return missing-item reports created by one account, newest first."""
        try:
            response = self.client.table('missing_items').select('*').eq('account_id', account_id).order('created_at', desc=True).execute()
            return response.data or []
        except Exception as e:
            logger.error(f"✗ Error fetching missing items: {e}")
            raise

    def get_public_missing_items(self) -> List[Dict[str, Any]]:
        """Return safe public fields for active missing-item reports."""
        response = self.client.table('missing_items').select(
            'mpost_id,item_name,category,description,last_location,last_seen_date,image_url,status,created_at'
        ).eq('status', 'missing').order('created_at', desc=True).limit(1000).execute()
        return response.data or []

    def get_public_found_items(self, limit: int = 4) -> List[Dict[str, Any]]:
        """Return safe fields for recent found-item cards on the public landing page."""
        response = self.client.table('found_items').select(
            'fpost_id,item_name,category,location,found_date,image_url,created_at'
        ).eq('status', 'unclaimed').order('created_at', desc=True).limit(limit).execute()
        return response.data or []

    def get_public_board(self, missing_limit: int = 8, found_limit: int = 8) -> Dict[str, Any]:
        """Newest open missing reports and unclaimed found items for the signed-out landing page.

        Only fields already shown on public lists are returned: no reporter name, email, campus ID, description or marks.
        """
        missing = self.client.table('missing_items').select(
            'mpost_id,item_name,category,last_location,last_seen_date,image_url,created_at', count='exact'
        ).eq('status', 'missing').order('created_at', desc=True).limit(missing_limit).execute()
        found = self.client.table('found_items').select(
            'fpost_id,item_name,category,location,found_date,image_url,created_at', count='exact'
        ).eq('status', 'unclaimed').order('created_at', desc=True).limit(found_limit).execute()
        return {
            'missing': missing.data or [],
            'found': found.data or [],
            'counts': {'missing': int(missing.count or 0), 'found': int(found.count or 0)},
        }

    def get_missing_items_for_matching(self) -> List[Dict[str, Any]]:
        """Return missing fields needed for private server-side matching."""
        response = self.client.table('missing_items').select(
            'mpost_id,item_name,category,description,distinctive_marks,last_location,last_seen_date,status'
        ).in_('status', ['missing', 'found']).order('created_at', desc=True).limit(1000).execute()
        return response.data or []

    def next_mpost_id(self, last_seen_date: str, weekday_code: str) -> str:
        """Generate the next globally unique MP<day number><sequence> identifier."""
        prefix = f"MP{weekday_code}"
        response = self.client.table('missing_items').select('mpost_id').like('mpost_id', f'{prefix}%').execute()
        sequences = []
        for row in response.data or []:
            value = str(row.get('mpost_id') or '')
            if value.startswith(prefix) and value[3:].isdigit():
                sequences.append(int(value[3:]))
        return f"{prefix}{(max(sequences, default=0) + 1):03d}"

    def _table_exists(self, table_name: str) -> bool:
        try:
            self.client.table(table_name).select('log_id').limit(1).execute()
            return True
        except Exception as e:
            logger.debug(f"Table {table_name} does not exist or is not accessible: {e}")
            return False

    def get_user_activity_logs(self, limit: int = 50) -> list[Dict[str, Any]]:
        """Return user activity logs from the configured user-activity table."""
        normalized = []
        candidates = ['user_activity_logs', 'activity_logs', 'admin_activity_logs']
        for table_name in candidates:
            if not self._table_exists(table_name):
                continue
            try:
                response = self.client.table(table_name).select('*').order('created_at', desc=True).limit(limit).execute()
                rows = response.data or []
                for row in rows:
                    normalized.append({
                        'id': str(row.get('log_id') or row.get('id') or 'LOG'),
                        'timestamp': row.get('created_at') or row.get('timestamp') or '',
                        'user': row.get('user_name') or row.get('account_name') or row.get('full_name') or row.get('admin_name') or row.get('user') or 'System',
                        'userId': str(row.get('account_id') or row.get('user_account_id') or row.get('user_id') or row.get('admin_account_id') or row.get('admin_id') or 'N/A'),
                        'action': row.get('action') or 'Activity',
                        'module': row.get('module_name') or row.get('module') or 'System',
                        'target': row.get('target_name') or row.get('target') or '-',
                        'targetId': str(row.get('target_id') or row.get('targetId') or '-'),
                        'result': {
                            'success': 'Success',
                            'warning': 'Warning',
                            'error': 'Error',
                        }.get(str(row.get('result') or 'success').strip().lower(), 'Success'),
                    })
                break
            except Exception as e:
                logger.warning(f"Unable to read activity log table '{table_name}': {e}")
                continue

        existing_item_codes = {
            str(activity.get('targetId') or '').strip().upper()
            for activity in normalized
            if activity.get('targetId')
        }
        try:
            claim_item_codes = {}
            if normalized:
                found_items = self.client.table('found_items').select(
                    'fpost_id, item_name'
                ).limit(500).execute()
                claim_item_codes = {
                    str(item.get('item_name') or '').strip().casefold(): item.get('fpost_id')
                    for item in found_items.data or []
                    if item.get('item_name') and item.get('fpost_id')
                }
                for activity in normalized:
                    is_claim = 'claim' in f"{activity.get('action', '')} {activity.get('module', '')}".casefold()
                    if is_claim and activity.get('targetId') in (None, '', '-', 'N/A'):
                        item_code = claim_item_codes.get(str(activity.get('target') or '').strip().casefold())
                        if item_code:
                            activity['targetId'] = str(item_code)

            item_sources = [
                ('missing_items', 'mpost_id', 'Report Missing Item', 'Lost Items', 'last_seen_date'),
                ('found_items', 'fpost_id', 'Report Found Item', 'Found Items', 'found_date'),
            ]
            linked_items = []
            for table_name, code_field, action, module, date_field in item_sources:
                response = self.client.table(table_name).select(
                    f'{code_field}, item_name, account_id, reporter_account_id, reporter_email, created_at, {date_field}'
                ).order('created_at', desc=True).limit(limit).execute()
                source_items = response.data or []
                reporter_ids = list({
                    str(item.get('reporter_account_id') or item.get('account_id'))
                    for item in source_items
                    if item.get('reporter_account_id') or item.get('account_id')
                })
                profile_map = {}
                if reporter_ids:
                    profiles = self.client.table('user_profiles').select(
                        'account_id, fname, lname, email'
                    ).in_('account_id', reporter_ids).execute()
                    profile_map = {
                        str(profile.get('account_id')): profile
                        for profile in profiles.data or []
                    }

                for item in source_items:
                    public_code = str(item.get(code_field) or '').strip()
                    if not public_code or public_code.upper() in existing_item_codes:
                        continue
                    reporter_id = str(item.get('reporter_account_id') or item.get('account_id') or '')
                    profile = profile_map.get(reporter_id) or {}
                    reporter_name = f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip()
                    linked_items.append({
                        'id': f'ITEM-{public_code}',
                        'timestamp': item.get('created_at') or item.get(date_field) or '',
                        'user': reporter_name or item.get('reporter_email') or 'User',
                        'userId': reporter_id or 'N/A',
                        'action': action,
                        'module': module,
                        'target': f"{public_code} — {item.get('item_name') or 'Item'}",
                        'targetId': public_code,
                        'result': 'Success',
                    })

            normalized.extend(linked_items)
            normalized.sort(key=lambda activity: str(activity.get('timestamp') or ''), reverse=True)
        except Exception as e:
            logger.warning(f"Unable to link item records to activity feed: {e}")

        return normalized[:limit]

    def get_activity_logs_for_actor_type(self, include_admins: bool, limit: int = 100) -> list[Dict[str, Any]]:
        """Return logs filtered by the current access level of each actor."""
        logs = self.get_user_activity_logs(limit=max(limit * 5, 500))
        account_ids = []
        for entry in logs:
            account_id = str(entry.get('userId') or '')
            try:
                UUID(account_id)
            except (ValueError, TypeError, AttributeError):
                continue
            if account_id not in account_ids:
                account_ids.append(account_id)
        profiles_by_id = {}
        if account_ids:
            response = self.client.table('user_profiles').select(
                'account_id,access_level,user_role'
            ).in_('account_id', account_ids).execute()
            profiles_by_id = {
                str(profile.get('account_id')): profile
                for profile in response.data or []
            }

        filtered = []
        for entry in logs:
            profile = profiles_by_id.get(str(entry.get('userId')))
            level = str((profile or {}).get('access_level') or '').strip().lower()
            legacy_role = str((profile or {}).get('user_role') or '').strip().lower()
            is_admin = level in {'admin', 'super_admin'} or legacy_role in {'admin', 'super_admin'}
            if is_admin == include_admins:
                filtered.append(entry)
            if len(filtered) >= limit:
                break
        return filtered

    def get_admin_activity_logs(self, limit: int = 50) -> list[Dict[str, Any]]:
        """Backward-compatible alias for user activity log reads."""
        return self.get_user_activity_logs(limit=limit)

    def get_admin_dashboard_summary(self) -> Dict[str, Any]:
        """Return summary metrics for the admin dashboard."""
        try:
            total_users = self.client.table('user_profiles').select('account_id', count='exact').execute()
            total_lost = self.client.table('missing_items').select('item_id', count='exact').execute()
            total_found = self.client.table('found_items').select('item_id', count='exact').execute()
            pending_claims = self.client.table('claims').select('claim_id', count='exact').eq('status', 'pending').execute()
            approved_claims = self.client.table('claims').select('claim_id', count='exact').eq('status', 'approved_for_pickup').execute()
            legacy_approved_claims = self.client.table('claims').select('claim_id', count='exact').eq('status', 'approved').execute()
            rejected_claims = self.client.table('claims').select('claim_id', count='exact').eq('status', 'rejected').execute()
            collected_claims = self.client.table('claims').select('claim_id', count='exact').eq('status', 'collected').execute()
            unresolved = self.client.table('found_items').select('item_id', count='exact').neq('status', 'returned').execute()

            ai_pending = self.client.table('ai_matches').select('match_id', count='exact').eq('status', 'pending').execute()
            ai_confirmed = self.client.table('ai_matches').select('match_id', count='exact').eq('status', 'confirmed').execute()
            ai_rejected = self.client.table('ai_matches').select('match_id', count='exact').eq('status', 'rejected').execute()
            returned_items = self.client.table('found_items').select('item_id', count='exact').eq('status', 'returned').execute()

            now = datetime.now(timezone.utc)
            first_month_index = now.year * 12 + now.month - 1 - 11
            first_month = datetime(first_month_index // 12, first_month_index % 12 + 1, 1, tzinfo=timezone.utc)
            month_keys = []
            for offset in range(12):
                month_index = first_month_index + offset
                year, month_zero = divmod(month_index, 12)
                month_keys.append(f'{year:04d}-{month_zero + 1:02d}')
            monthly_counts = {key: {'lost': 0, 'found': 0} for key in month_keys}

            def read_recent_dates(table_name: str, field_name: str) -> list[Dict[str, Any]]:
                rows = []
                offset = 0
                while offset < 10000:
                    response = self.client.table(table_name).select(field_name).gte(
                        field_name, first_month.date().isoformat()
                    ).order(field_name).range(offset, offset + 999).execute()
                    batch = response.data or []
                    rows.extend(batch)
                    if len(batch) < 1000:
                        break
                    offset += 1000
                return rows

            for row in read_recent_dates('missing_items', 'last_seen_date'):
                value = str(row.get('last_seen_date') or '')[:7]
                if value in monthly_counts:
                    monthly_counts[value]['lost'] += 1
            for row in read_recent_dates('found_items', 'found_date'):
                value = str(row.get('found_date') or '')[:7]
                if value in monthly_counts:
                    monthly_counts[value]['found'] += 1

            chart_data = [
                {
                    'month': datetime.strptime(key, '%Y-%m').strftime('%b %Y'),
                    **monthly_counts[key],
                }
                for key in month_keys
            ]

            completed_rows = self.client.table('claims').select(
                'created_at,collected_at'
            ).eq('status', 'collected').order('collected_at', desc=True).limit(1000).execute()
            resolution_days = []
            for row in completed_rows.data or []:
                try:
                    created_at = datetime.fromisoformat(str(row.get('created_at') or '').replace('Z', '+00:00'))
                    collected_at = datetime.fromisoformat(str(row.get('collected_at') or '').replace('Z', '+00:00'))
                    if created_at.tzinfo is None:
                        created_at = created_at.replace(tzinfo=timezone.utc)
                    if collected_at.tzinfo is None:
                        collected_at = collected_at.replace(tzinfo=timezone.utc)
                    elapsed = (collected_at - created_at).total_seconds() / 86400
                    if elapsed >= 0:
                        resolution_days.append(elapsed)
                except (TypeError, ValueError):
                    continue

            returned_count = int(returned_items.count or 0)
            total_lost_count = int(total_lost.count or 0)
            confirmed_count = int(ai_confirmed.count or 0)
            rejected_count = int(ai_rejected.count or 0)
            reviewed_claim_count = (
                int(approved_claims.count or 0)
                + int(legacy_approved_claims.count or 0)
                + int(collected_claims.count or 0)
                + int(rejected_claims.count or 0)
            )
            approved_claim_count = int(approved_claims.count or 0) + int(legacy_approved_claims.count or 0) + int(collected_claims.count or 0)

            recent_activity = self.get_admin_activity_logs(limit=5)
            summary = {
                'total_users': int((total_users.count or 0)),
                'total_lost_reports': total_lost_count,
                'found_items': int((total_found.count or 0)),
                'potential_ai_matches': int(ai_pending.count or 0),
                'pending_claims': int((pending_claims.count or 0)),
                'successfully_returned': returned_count,
                'unresolved_items': int((unresolved.count or 0)),
                'chart_data': chart_data,
                'average_resolution_days': round(sum(resolution_days) / len(resolution_days), 1) if resolution_days else None,
                'ai_confirmed': confirmed_count,
                'ai_decided': confirmed_count + rejected_count,
                'claim_approval_rate': round(approved_claim_count / reviewed_claim_count * 100, 1) if reviewed_claim_count else 0,
                'reviewed_claims': reviewed_claim_count,
                'collected_claims': int(collected_claims.count or 0),
                'claim_status_counts': {
                    'Under Review': int(pending_claims.count or 0),
                    'Approved for Pickup': int(approved_claims.count or 0) + int(legacy_approved_claims.count or 0),
                    'Rejected': int(rejected_claims.count or 0),
                    'Collected': int(collected_claims.count or 0),
                },
                'current_month_processed': monthly_counts[month_keys[-1]]['lost'] + monthly_counts[month_keys[-1]]['found'],
                'recovery_rate': round(returned_count / int(total_found.count or 0) * 100, 1) if total_found.count else 0,
                'recent_activity': recent_activity,
            }
            return summary
        except Exception as e:
            logger.error(f"✗ Error fetching admin dashboard summary: {e}")
            raise

    def get_admin_analytics_breakdowns(self) -> Dict[str, Any]:
        """Aggregate category and location counts without returning full item records."""
        category_counts: Dict[str, int] = {}
        location_counts: Dict[str, Dict[str, int]] = {}

        for table_name, location_column, item_type in (
            ('missing_items', 'last_location', 'lost'),
            ('found_items', 'location', 'found'),
        ):
            offset = 0
            while offset < 100000:
                response = self.client.table(table_name).select(
                    f'category,{location_column}'
                ).range(offset, offset + 999).execute()
                rows = response.data or []
                for row in rows:
                    category = str(row.get('category') or 'General').strip() or 'General'
                    category_counts[category] = category_counts.get(category, 0) + 1

                    location = str(row.get(location_column) or 'Unknown').strip() or 'Unknown'
                    counts = location_counts.setdefault(location, {'lost': 0, 'found': 0})
                    counts[item_type] += 1
                if len(rows) < 1000:
                    break
                offset += 1000

        return {
            'categories': [
                {'name': name, 'value': value}
                for name, value in sorted(category_counts.items(), key=lambda entry: entry[1], reverse=True)
            ],
            'locations': [
                {'location': location, **counts}
                for location, counts in sorted(
                    location_counts.items(),
                    key=lambda entry: entry[1]['lost'] + entry[1]['found'],
                    reverse=True,
                )
            ],
        }

    def list_admin_users(self) -> list[Dict[str, Any]]:
        """Return a user list in the shape the admin UI expects."""
        try:
            columns = 'account_id, campus_id, fname, mname, lname, email, user_role, access_level, is_active, created_at, last_login_at, verification_status'
            if self.supports_governance_fields:
                columns += ', user_category, suspended_until'
            users = fetch_all(lambda: self.client.table('user_profiles').select(columns).order('created_at', desc=True))

            def count_by_account(table_name: str, account_column: str) -> Dict[str, int]:
                counts: Dict[str, int] = {}
                offset = 0
                while offset < 100000:
                    rows_response = self.client.table(table_name).select(account_column).range(offset, offset + 999).execute()
                    rows = rows_response.data or []
                    for row in rows:
                        account_id = str(row.get(account_column) or '')
                        if account_id:
                            counts[account_id] = counts.get(account_id, 0) + 1
                    if len(rows) < 1000:
                        break
                    offset += 1000
                return counts

            report_counts = count_by_account('missing_items', 'account_id')
            claim_counts = count_by_account('claims', 'claimant_account_id')
            mapped = []
            for user in users:
                account_id = str(user['account_id'])
                status = 'Active' if user.get('is_active') is not False else 'Suspended'
                mapped.append({
                    'id': account_id,
                    'name': f"{user.get('fname') or ''} {user.get('lname') or ''}".strip(),
                    'initials': (user.get('fname') or 'U')[0].upper() + (user.get('lname') or 'U')[0].upper(),
                    'studentId': user.get('campus_id') or 'N/A',
                    'email': user.get('email') or '',
                    'program': user.get('user_category') or user.get('user_role') or 'Student',
                    'category': user.get('user_category'),
                    'verification': str(user.get('verification_status') or 'pending').lower(),
                    'suspendedUntil': user.get('suspended_until') if status == 'Suspended' else None,
                    'accessLevel': user.get('access_level') or ('admin' if str(user.get('user_role') or '').lower() == 'admin' else 'user'),
                    'reports': report_counts.get(account_id, 0),
                    'claims': claim_counts.get(account_id, 0),
                    'status': status,
                    'lastActivity': user.get('last_login_at') or user.get('created_at') or 'Unknown',
                })
            return mapped
        except Exception as e:
            logger.error(f"✗ Error listing admin users: {e}")
            raise

    def list_admin_ai_matches(self) -> list[Dict[str, Any]]:
        """Return the best live AI match candidates between missing and found items with persisted status."""
        try:
            # Fetch all items
            missing_response = self.client.table('missing_items').select(
                'item_id, mpost_id, item_name, category, description, distinctive_marks, last_location, last_seen_date, image_url, status'
            ).order('created_at', desc=True).execute()
            found_response = self.client.table('found_items').select(
                'item_id, fpost_id, item_name, category, description, location, found_date, image_url, status'
            ).order('created_at', desc=True).execute()

            # Fetch all AI match records from database
            ai_matches_response = self.client.table('ai_matches').select(
                'missing_item_id, found_item_id, status, confirmed_at, rejected_at, created_at'
            ).execute()

            missing_items = missing_response.data or []
            found_items = found_response.data or []
            ai_matches_db = ai_matches_response.data or []

            # Create lookup map for database match statuses and timestamps
            db_match_status = {}
            db_match_timestamp = {}
            for match in ai_matches_db:
                key = f"{match.get('missing_item_id')}:{match.get('found_item_id')}"
                db_match_status[key] = match.get('status')
                db_match_timestamp[key] = match.get('confirmed_at') or match.get('rejected_at') or match.get('created_at')

            matches = []

            for missing in missing_items:
                best_match = None
                best_score = -1
                for found in found_items:
                    score = match_percentage(missing, found)
                    if score > best_score:
                        best_match = found
                        best_score = score

                if best_match is None or best_score < 55:
                    continue

                # Check if this match has a persisted status in ai_matches table
                match_key = f"{missing.get('item_id')}:{best_match.get('item_id')}"
                db_status = db_match_status.get(match_key)
                
                if db_status:
                    # Use status from database (confirmed/rejected)
                    status = 'Confirmed' if db_status == 'confirmed' else 'Rejected'
                    decision_timestamp = db_match_timestamp.get(match_key) or ''
                else:
                    # Use calculated status
                    status = 'High Confidence' if best_score >= 80 else 'Needs Review'
                    decision_timestamp = ''

                matches.append({
                    'id': f"M-{len(matches) + 1:03d}",
                    'status': status,
                    'timestamp': decision_timestamp,
                    'lostId': missing.get('mpost_id') or 'N/A',
                    'lostItem': missing.get('item_name') or 'Unknown Item',
                    'lostDesc': missing.get('description') or missing.get('distinctive_marks') or 'No description',
                    'lostLocation': missing.get('last_location') or 'Unknown',
                    'lostDate': missing.get('last_seen_date') or '',
                    'lostImage': missing.get('image_url') or '',
                    'foundId': best_match.get('fpost_id') or 'N/A',
                    'foundItem': best_match.get('item_name') or 'Unknown Item',
                    'foundDesc': best_match.get('description') or 'No description',
                    'foundLocation': best_match.get('location') or 'Unknown',
                    'foundDate': best_match.get('found_date') or '',
                    'foundImage': best_match.get('image_url') or '',
                    'matchPercent': int(best_score),
                    'visualSim': min(100, int(best_score + 5)),
                    'descSim': min(100, max(50, int(best_score))),
                    'locationSim': min(100, max(60, int(best_score - 5))),
                    'timeSim': min(100, max(50, int(best_score * 0.9))),
                })

            return matches[:10]
        except Exception as e:
            logger.error(f"✗ Error listing admin AI matches: {e}")
            raise

    def list_admin_missing_items(self) -> list[Dict[str, Any]]:
        """Return lost-item records in the shape the admin Lost Items page expects."""
        try:
            items = fetch_all(lambda: self.client.table('missing_items').select(
                'item_id, mpost_id, account_id, reporter_account_id, reporter_name, item_name, category, description, last_location, last_seen_date, image_url, status, created_at, reporter_email, reporter_campus_id, distinctive_marks'
            ).order('created_at', desc=True))
            reporter_ids = []
            for item in items:
                reporter_id = item.get('reporter_account_id') or item.get('account_id')
                if reporter_id and reporter_id not in reporter_ids:
                    reporter_ids.append(reporter_id)

            profile_map: Dict[str, Dict[str, Any]] = {}
            if reporter_ids:
                profiles_response = self.client.table('user_profiles').select('account_id, fname, lname, campus_id, email').in_('account_id', reporter_ids).execute()
                for profile in profiles_response.data or []:
                    profile_map[str(profile.get('account_id'))] = profile

            mapped = []
            for item in items:
                reporter_id = item.get('reporter_account_id') or item.get('account_id')
                reporter_profile = profile_map.get(str(reporter_id)) or {}
                reporter_name = item.get('reporter_name') or f"{reporter_profile.get('fname') or ''} {reporter_profile.get('lname') or ''}".strip() or item.get('reporter_email') or 'Unknown User'
                report_status = str(item.get('status') or '').lower()
                mapped.append({
                    'id': str(item.get('mpost_id') or item.get('item_id') or 'N/A'),
                    'item': item.get('item_name') or 'Unknown Item',
                    'description': item.get('description') or item.get('distinctive_marks') or 'No description',
                    'category': item.get('category') or 'General',
                    'location': item.get('last_location') or 'Unknown',
                    'dateLost': item.get('last_seen_date') or '',
                    'reportedBy': reporter_name,
                    'studentId': reporter_profile.get('campus_id') or item.get('reporter_campus_id') or 'N/A',
                    'photo': item.get('image_url') or '',
                    'aiMatch': None,
                    'status': 'Completed' if report_status in {'returned', 'resolved', 'closed'} else 'Found' if report_status == 'found' else 'Potential Match' if report_status == 'matched' else 'Searching',
                    'rawStatus': report_status or 'missing',
                })
            flag_archived(self.client, mapped, 'missing_items', 'mpost_id')
            return mapped
        except Exception as e:
            logger.error(f"✗ Error listing admin missing items: {e}")
            raise

    def list_admin_found_items(self) -> list[Dict[str, Any]]:
        """Return found-item records in the shape the admin Found Items page expects."""
        try:
            # Only open lost reports can still match something, so completed ones are not compared.
            missing_items = fetch_all(lambda: self.client.table('missing_items').select(
                'mpost_id, item_id, item_name, category, description, distinctive_marks, last_location, last_seen_date, status'
            ).in_('status', ['missing', 'found', 'open', 'matched']).order('created_at', desc=True))

            items = fetch_all(lambda: self.client.table('found_items').select(
                'item_id, fpost_id, account_id, reporter_account_id, reporter_name, item_name, category, description, location, found_date, image_url, turnover_location, guard_name_or_id, status, custody_status, created_at, reporter_email, reporter_campus_id'
            ).order('created_at', desc=True))

            best_match_scores = {}
            best_match_names = {}
            for item in items:
                item_key = str(item.get('fpost_id') or item.get('item_id') or '')
                best_score = 0.0
                best_name = ''
                if str(item.get('status') or '').lower() in FINISHED_FOUND_STATUSES:
                    best_match_scores[item_key] = best_score
                    best_match_names[item_key] = best_name
                    continue   # an item that already left custody has nothing left to match
                for missing in missing_items:
                    score = match_percentage(missing, item)
                    if score > best_score:
                        best_score = score
                        best_name = missing.get('item_name') or 'Unknown Item'
                best_match_scores[item_key] = best_score
                best_match_names[item_key] = best_name

            reporter_ids = []
            for item in items:
                reporter_id = item.get('reporter_account_id') or item.get('account_id')
                if reporter_id and reporter_id not in reporter_ids:
                    reporter_ids.append(reporter_id)

            profile_map: Dict[str, Dict[str, Any]] = {}
            if reporter_ids:
                profiles_response = self.client.table('user_profiles').select('account_id, fname, lname, campus_id, email').in_('account_id', reporter_ids).execute()
                for profile in profiles_response.data or []:
                    profile_map[str(profile.get('account_id'))] = profile

            mapped = []
            for item in items:
                item_key = str(item.get('fpost_id') or item.get('item_id') or '')
                report_status = str(item.get('status') or '').lower()
                ui_status = 'Completed' if report_status in FINISHED_FOUND_STATUSES else 'Under Review' if report_status in {'pending', 'review'} else 'Ready to Release' if report_status == 'ready_to_release' else 'Auctioned' if report_status == 'auctioned' else 'Unclaimed'
                ai_score = float(best_match_scores.get(item_key, 0.0) or 0.0)
                ai_matched = ai_score >= 55
                mapped.append({
                    'id': str(item.get('fpost_id') or item.get('item_id') or 'N/A'),
                    'item': item.get('item_name') or 'Unknown Item',
                    'description': item.get('description') or 'No description',
                    'category': item.get('category') or 'General',
                    'locationFound': item.get('location') or 'Unknown',
                    'dateFound': item.get('found_date') or item.get('created_at') or '',
                    'guardName': item.get('guard_name_or_id') or '',
                    'createdAt': item.get('created_at') or item.get('found_date') or '',
                    'storage': item.get('turnover_location') or item.get('location') or 'Unknown',
                    'aiStatus': 'Matched' if ai_matched else 'No Match',
                    'aiPercent': int(ai_score) if ai_matched else None,
                    'matchedItem': best_match_names.get(item_key, '') if ai_matched else '',
                    'status': ui_status,
                    'rawStatus': report_status or 'unclaimed',
                    'photo': item.get('image_url') or '',
                })
            flag_archived(self.client, mapped, 'found_items', 'fpost_id')
            return mapped
        except Exception as e:
            logger.error(f"✗ Error listing admin found items: {e}")
            raise

    def _utc_now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _create_signed_storage_url(self, bucket: str, path: str, expires_in: int = 300) -> Optional[str]:
        if not path:
            return None
        try:
            result = self.client.storage.from_(bucket).create_signed_url(path, expires_in)
            if isinstance(result, dict):
                return result.get('signedURL') or result.get('signedUrl') or result.get('signed_url') or result.get('url')
        except Exception as e:
            logger.warning("Unable to create signed URL for private bucket '%s': %s", bucket, e)
        return None

    def _admin_item_row(self, table_name: str, reference_column: str, reference: str) -> Optional[Dict[str, Any]]:
        response = self.client.table(table_name).select('*').eq(reference_column, reference).limit(1).execute()
        if response.data:
            return response.data[0]
        try:
            UUID(str(reference))
        except (ValueError, TypeError, AttributeError):
            return None
        response = self.client.table(table_name).select('*').eq('item_id', reference).limit(1).execute()
        return response.data[0] if response.data else None

    def _remove_public_item_image(self, bucket: str, image_url: Optional[str]) -> None:
        marker = f'/object/public/{bucket}/'
        if not image_url or marker not in image_url:
            return
        path = unquote(image_url.split(marker, 1)[1].split('?', 1)[0])
        if not path:
            return
        try:
            self.client.storage.from_(bucket).remove([path])
        except Exception as error:
            logger.warning('Unable to remove deleted item image from %s: %s', bucket, error)

    def _account_storage_path(self, bucket: str, value: Optional[str], allow_raw_path: bool = False) -> Optional[str]:
        if not value or not isinstance(value, str) or value.startswith('data:'):
            return None
        for object_visibility in ('public', 'sign'):
            marker = f'/object/{object_visibility}/{bucket}/'
            if marker in value:
                path = unquote(value.split(marker, 1)[1].split('?', 1)[0])
                return path or None
        if value.startswith(('http://', 'https://')):
            return None
        return value.lstrip('/') if allow_raw_path else None

    def _archive_before_delete(self, entity_type: str, reference: str, admin_account_id: str) -> str:
        """Copy what is about to be deleted into the recycle bin. Raises BinError (and the caller deletes nothing) if that fails."""
        from app.utils.recycle_bin import RecycleBin
        actor = self.get_user_by_account_id(admin_account_id) or {}
        return RecycleBin(self).archive_entity(entity_type, reference, admin_account_id, actor.get('email') or 'Admin')

    def _undo_archive(self, archive_id: str) -> None:
        from app.utils.recycle_bin import RecycleBin
        RecycleBin(self).discard(archive_id)

    def delete_admin_user(self, target_account_id: str, admin_account_id: str, totp_step: int) -> Dict[str, Any]:
        """Delete an account through a superadmin/TOTP-guarded RPC, then clean its Storage objects."""
        profile = self.get_user_by_account_id(target_account_id)
        if not profile:
            raise RuntimeError('User not found')
        profile = self._decrypt_profile_sensitive_fields(profile) or profile

        storage_objects: Dict[str, set[str]] = {}

        def track_object(bucket: Optional[str], path: Optional[str]) -> None:
            if bucket and path:
                storage_objects.setdefault(bucket, set()).add(path)

        verification_bucket = profile.get('verification_document_bucket')
        verification_path = self._account_storage_path(
            str(verification_bucket or ''), profile.get('verification_document_url'), allow_raw_path=True
        )
        track_object(verification_bucket, verification_path)

        found_response = self.client.table('found_items').select(
            'item_id,image_url'
        ).eq('account_id', target_account_id).execute()
        found_rows = found_response.data or []
        found_item_ids = [str(row['item_id']) for row in found_rows if row.get('item_id')]
        for row in found_rows:
            track_object('found-item-images', self._account_storage_path('found-item-images', row.get('image_url')))

        missing_response = self.client.table('missing_items').select(
            'item_id,image_url'
        ).eq('account_id', target_account_id).execute()
        for row in missing_response.data or []:
            track_object('missing-item-images', self._account_storage_path('missing-item-images', row.get('image_url')))

        claim_rows_by_id: Dict[str, Dict[str, Any]] = {}
        claim_columns = 'claim_id,found_item_id,claimant_account_id,proof_image_url,proof_image_path,identity_document_path'
        own_claims = self.client.table('claims').select(claim_columns).eq(
            'claimant_account_id', target_account_id
        ).execute()
        for row in own_claims.data or []:
            claim_rows_by_id[str(row['claim_id'])] = row
        if found_item_ids:
            item_claims = self.client.table('claims').select(claim_columns).in_(
                'found_item_id', found_item_ids
            ).execute()
            for row in item_claims.data or []:
                claim_rows_by_id[str(row['claim_id'])] = row

        for claim in claim_rows_by_id.values():
            proof_path = claim.get('proof_image_path') or self._legacy_claim_storage_path(
                self._decrypt_claim_sensitive_fields(claim).get('proof_image_url'), 'claim-proof-images'
            )
            if not proof_path:
                proof_path = self._account_storage_path('claim-proof-images', claim.get('proof_image_url'))
            track_object('claim-proof-images', proof_path)
            track_object(
                'claim-id-documents',
                self._account_storage_path('claim-id-documents', claim.get('identity_document_path'), allow_raw_path=True),
            )

        archive_id = self._archive_before_delete('user', target_account_id, admin_account_id)
        try:
            response = self.client.rpc('admin_delete_user', {
                'p_target_account_id': target_account_id,
                'p_admin_id': admin_account_id,
                'p_totp_step': int(totp_step),
            }).execute()
        except Exception:
            self._undo_archive(archive_id)
            raise
        deleted_user = response.data
        if isinstance(deleted_user, list):
            deleted_user = deleted_user[0] if deleted_user else None
        if not deleted_user:
            self._undo_archive(archive_id)
            raise RuntimeError('User not found or was not deleted')
        deleted_user['archive_id'] = archive_id

        cleanup_failures = []
        for bucket, paths in storage_objects.items():
            try:
                self.client.storage.from_(bucket).remove(list(paths))
            except Exception as error:
                cleanup_failures.append(bucket)
                logger.exception('User %s was deleted, but Storage cleanup failed for bucket %s: %s', target_account_id, bucket, error)

        deleted_user['storage_cleanup_complete'] = not cleanup_failures
        deleted_user['storage_cleanup_failures'] = cleanup_failures
        return deleted_user

    # Lifecycle values documented on missing_items.status ('returned' is also written by claim collection).
    ADMIN_MISSING_ITEM_STATUSES = frozenset({'missing', 'found', 'returned'})

    def update_admin_missing_item(self, reference: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        field_map = {
            'item': 'item_name',
            'description': 'description',
            'category': 'category',
            'location': 'last_location',
            'dateLost': 'last_seen_date',
            'reportedBy': 'reporter_name',
            'studentId': 'reporter_campus_id',
        }
        update = {column: payload[key] for key, column in field_map.items() if key in payload}
        if 'status' in payload:
            status = str(payload['status'] or '').strip().lower()
            if status not in self.ADMIN_MISSING_ITEM_STATUSES:
                raise ValueError('Invalid lost item status')
            update['status'] = status
        if not update:
            return {}
        update['updated_at'] = self._utc_now_iso()
        item = self._admin_item_row('missing_items', 'mpost_id', reference)
        if not item:
            return {}
        response = self.client.table('missing_items').update(update).eq('item_id', item['item_id']).execute()
        if update.get('status') == 'returned' and str(item.get('status') or '').lower() != 'returned':
            ReportLifecycle(self).notify_completed_by_hand(item)   # same notice as a release, so the owner is never left guessing
        return response.data[0] if response.data else {}

    def delete_admin_missing_item(self, reference: str, admin_account_id: str) -> bool:
        try:
            archive_id = self._archive_before_delete('missing_item', reference, admin_account_id)
        except Exception as error:
            if getattr(error, 'status', None) == 404:
                return False   # nothing to delete: the route answers "not found"
            raise
        try:
            response = self.client.rpc('admin_delete_missing_item', {
                'p_item_reference': reference,
                'p_admin_id': admin_account_id,
            }).execute()
        except Exception:
            self._undo_archive(archive_id)
            raise
        item = response.data
        if isinstance(item, list):
            item = item[0] if item else None
        if not item:
            self._undo_archive(archive_id)
            return False
        self._remove_public_item_image('missing-item-images', item.get('image_url'))
        return True

    def update_admin_found_item(self, reference: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        field_map = {
            'item': 'item_name',
            'description': 'description',
            'category': 'category',
            'locationFound': 'location',
            'dateFound': 'found_date',
            'storage': 'turnover_location',
            'photo': 'image_url',
        }
        update = {column: payload[key] for key, column in field_map.items() if key in payload}
        if 'status' in payload:
            allowed_statuses = {'unclaimed', 'claimed', 'returned', 'pending', 'review', 'ready_to_release'}
            status = str(payload['status']).strip().lower()
            if status not in allowed_statuses:
                raise ValueError('Invalid found item status')
            update['status'] = status
        if not update:
            return {}
        update['updated_at'] = self._utc_now_iso()
        item = self._admin_item_row('found_items', 'fpost_id', reference)
        if not item:
            return {}
        response = self.client.table('found_items').update(update).eq('item_id', item['item_id']).execute()
        if update.get('status') == 'returned' and str(item.get('status') or '').lower() != 'returned':
            ReportLifecycle(self).complete_for_found_item(item['item_id'])
        return response.data[0] if response.data else {}

    def delete_admin_found_item(self, reference: str, admin_account_id: str) -> bool:
        try:
            archive_id = self._archive_before_delete('found_item', reference, admin_account_id)
        except Exception as error:
            if getattr(error, 'status', None) == 404:
                return False
            raise
        try:
            response = self.client.rpc('admin_delete_found_item', {
                'p_item_reference': reference,
                'p_admin_id': admin_account_id,
            }).execute()
        except Exception:
            self._undo_archive(archive_id)
            raise
        item = response.data
        if isinstance(item, list):
            item = item[0] if item else None
        if not item:
            self._undo_archive(archive_id)
            return False
        self._remove_public_item_image('found-item-images', item.get('image_url'))
        return True

    def update_user_status(self, account_id: str, status: str, days: Optional[int] = None, reason: Optional[str] = None, actor_id: Optional[str] = None) -> Dict[str, Any]:
        """Activate or suspend an account. `days` makes a suspension expire on its own; None means until reactivated."""
        try:
            normalized = str(status or '').strip().lower()
            if normalized not in {'active', 'suspended'}:
                raise ValueError(f"Invalid user status: {status}")
            if days is not None and (not isinstance(days, int) or days < 1 or days > 365):
                raise ValueError('A suspension must last between 1 and 365 days')
            active_value = normalized == 'active'
            payload: Dict[str, Any] = {'is_active': active_value, 'updated_at': self._utc_now_iso()}
            if self.supports_governance_fields:
                if active_value:
                    payload.update({'suspended_until': None, 'suspension_reason': None, 'suspended_by': None})
                else:
                    payload.update({
                        'suspended_until': (datetime.now(timezone.utc) + timedelta(days=days)).isoformat() if days else None,
                        'suspension_reason': (reason or '').strip()[:300] or None,
                        'suspended_by': actor_id,
                    })
            elif days:
                raise RuntimeError('Timed suspensions need the 20261006_system_control_verification.sql migration. Run it in Supabase, or suspend without a time limit.')
            response = self.client.table('user_profiles').update(payload).eq('account_id', account_id).execute()
            from app.utils.system_control import forget_account  # the new status must apply to the very next request
            forget_account(account_id)
            return response.data[0] if response.data else {}
        except Exception as e:
            logger.exception("✗ Error updating user status for account_id=%s status=%s: %s", account_id, status, repr(e))
            raise

    def set_user_access_level(self, target_account_id: str, access_level: str, actor_account_id: str) -> Dict[str, Any]:
        response = self.client.rpc('admin_set_user_access_level', {
            'p_target_account_id': target_account_id,
            'p_access_level': access_level,
            'p_actor_account_id': actor_account_id,
        }).execute()
        updated = response.data
        if isinstance(updated, list):
            updated = updated[0] if updated else None
        if not updated:
            raise RuntimeError('Access level was not updated')
        return updated

    def get_admin_mfa(self, account_id: str) -> Optional[Dict[str, Any]]:
        response = self.client.table('admin_mfa').select('*').eq('account_id', account_id).limit(1).execute()
        return response.data[0] if response.data else None

    def save_admin_mfa_pending(self, account_id: str, secret: str, expires_at: str) -> None:
        self.client.table('admin_mfa').upsert({
            'account_id': account_id,
            'pending_secret_ciphertext': CryptoService.encrypt(secret),
            'pending_expires_at': expires_at,
            'failed_attempts': 0,
            'locked_until': None,
            'updated_at': self._utc_now_iso(),
        }, on_conflict='account_id').execute()

    def replace_admin_mfa_recovery_codes(self, account_id: str, code_hashes: list[str]) -> None:
        self.client.table('admin_mfa_recovery_codes').delete().eq('account_id', account_id).execute()
        if code_hashes:
            self.client.table('admin_mfa_recovery_codes').insert([
                {'account_id': account_id, 'code_hash': code_hash}
                for code_hash in code_hashes
            ]).execute()

    def enable_admin_mfa(self, account_id: str, secret: str, accepted_step: int) -> int:
        response = self.client.rpc('admin_enable_mfa', {
            'p_account_id': account_id,
            'p_secret_ciphertext': CryptoService.encrypt(secret),
            'p_totp_step': accepted_step,
        }).execute()
        return int(response.data)

    def disable_admin_mfa(self, account_id: str) -> None:
        self.client.rpc('admin_disable_mfa', {'p_account_id': account_id}).execute()

    def create_admin_mfa_challenge(self, account_id: str, challenge_id: str, expires_at: str) -> None:
        self.client.table('admin_mfa_challenges').delete().lt('expires_at', self._utc_now_iso()).execute()
        self.client.table('admin_mfa_challenges').insert({
            'challenge_id': challenge_id,
            'account_id': account_id,
            'expires_at': expires_at,
        }).execute()

    def record_admin_mfa_failure(self, account_id: str) -> None:
        self.client.rpc('record_admin_mfa_failure', {'p_account_id': account_id}).execute()

    def consume_admin_mfa_challenge(self, challenge_id: str, account_id: str, accepted_step: Optional[int]) -> bool:
        response = self.client.rpc('consume_admin_mfa_challenge', {
            'p_challenge_id': challenge_id,
            'p_account_id': account_id,
            'p_totp_step': accepted_step,
        }).execute()
        return bool(response.data)

    def consume_admin_mfa_step(self, account_id: str, accepted_step: int) -> bool:
        response = self.client.rpc('consume_admin_mfa_step', {
            'p_account_id': account_id,
            'p_totp_step': accepted_step,
        }).execute()
        return bool(response.data)

    def consume_admin_mfa_recovery_code(self, account_id: str, code_hash: str, challenge_id: str) -> bool:
        response = self.client.rpc('consume_admin_mfa_recovery_code', {
            'p_account_id': account_id,
            'p_code_hash': code_hash,
            'p_challenge_id': challenge_id,
        }).execute()
        return bool(response.data)

    def list_admin_claims(self) -> list[Dict[str, Any]]:
        """Return claim rows in admin-friendly shape."""
        try:
            claims = fetch_all(lambda: self.client.table('claims').select(
                'claim_id, claim_reference, found_item_id, claimant_account_id, claim_reason, proof_image_url, proof_image_path, identity_document_path, identity_document_type, identity_document_name, rejection_reason, status, created_at, reviewed_at, updated_at, collected_at'
            ).order('created_at', desc=True))

            found_item_ids = list({
                str(row.get('found_item_id'))
                for row in claims
                if row.get('found_item_id')
            })
            claimant_ids = list({
                str(row.get('claimant_account_id'))
                for row in claims
                if row.get('claimant_account_id')
            })

            found_items_by_id = {}
            if found_item_ids:
                found_response = self.client.table('found_items').select(
                    'item_id, fpost_id, item_name, category, description, location, found_date, image_url'
                ).in_('item_id', found_item_ids).execute()
                found_items_by_id = {
                    str(row.get('item_id')): row
                    for row in (found_response.data or [])
                }

            claimants_by_id = {}
            if claimant_ids:
                claimant_response = self.client.table('user_profiles').select(
                    'account_id, campus_id, fname, lname, email'
                ).in_('account_id', claimant_ids).execute()
                claimants_by_id = {
                    str(row.get('account_id')): row
                    for row in (claimant_response.data or [])
                }

            # Claims on an item that is in an auction right now: approving one cancels that auction, so the admin is warned first.
            auctioned_items: set = set()
            try:
                for start in range(0, len(found_item_ids), 100):
                    rows = self.client.table('auctions').select('found_item_id').in_('found_item_id', found_item_ids[start:start + 100])                         .in_('status', ['scheduled', 'active', 'awaiting_admin']).execute().data or []
                    auctioned_items.update(str(r['found_item_id']) for r in rows)
            except Exception as auction_error:
                logger.info('Auction flags for claims unavailable: %s', auction_error)

            mapped = []
            for claim in claims:
                decrypted_claim = self._decrypt_claim_sensitive_fields(claim)
                claimant = claimants_by_id.get(str(claim.get('claimant_account_id'))) or {}
                found_item = found_items_by_id.get(str(claim.get('found_item_id'))) or {}
                identity_path = decrypted_claim.get('identity_document_path')
                proof_path = decrypted_claim.pop('proof_image_path', None) or self._legacy_claim_storage_path(decrypted_claim.get('proof_image_url'), 'claim-proof-images')
                mapped.append({
                    'id': str(decrypted_claim.get('claim_id')),
                    'claimReference': decrypted_claim.get('claim_reference') or '',
                    'foundItemId': str(decrypted_claim.get('found_item_id') or ''),
                    'inAuction': str(decrypted_claim.get('found_item_id') or '') in auctioned_items,
                    'claimant': f"{claimant.get('fname') or ''} {claimant.get('lname') or ''}".strip() or 'Unknown User',
                    'studentId': claimant.get('campus_id') or 'N/A',
                    'claimantEmail': claimant.get('email') or '',
                    'item': found_item.get('item_name') or 'Unknown Item',
                    'itemId': found_item.get('fpost_id') or 'N/A',
                    'itemCategory': found_item.get('category') or '',
                    'itemLocation': found_item.get('location') or '',
                    'itemFoundDate': found_item.get('found_date') or '',
                    'itemDescription': found_item.get('description') or 'No description provided',
                    'claimReason': decrypted_claim.get('claim_reason') or 'No additional details provided',
                    'proofImage': self._create_signed_storage_url('claim-proof-images', proof_path),
                    'identityDocument': self._create_signed_storage_url('claim-id-documents', identity_path),
                    'identityDocumentType': decrypted_claim.get('identity_document_type') or '',
                    'rejectionReason': decrypted_claim.get('rejection_reason') or '',
                    'foundImage': found_item.get('image_url') or '',
                    'submitted': claim.get('created_at') or '',
                    'submittedAt': claim.get('created_at') or '',
                    'status': {
                        'pending': 'Under Review',
                        'approved_for_pickup': 'Approved for Pickup',
                        'rejected': 'Rejected',
                        'collected': 'Completed',
                    }.get(normalize_claim_status(claim.get('status')), 'Unknown'),
                })
            flag_archived(self.client, mapped, 'claims', 'claim_id')
            return mapped
        except Exception as e:
            logger.error(f"✗ Error listing admin claims: {e}")
            raise

    def list_admin_claim_history(self) -> list[Dict[str, Any]]:
        """Return the newest recorded claim changes for the admin history tab."""
        response = self.client.table('claim_change_history').select(
            'history_id,claim_id,claim_reference,found_item_id,found_item_reference,actor_account_id,action,old_values,new_values,changed_at'
        ).order('changed_at', desc=True).limit(1000).execute()
        history = response.data or []

        profile_ids = set()
        found_item_ids = set()
        for entry in history:
            if entry.get('actor_account_id'):
                profile_ids.add(str(entry['actor_account_id']))
            for snapshot in (entry.get('old_values'), entry.get('new_values')):
                if snapshot and snapshot.get('claimant_account_id'):
                    profile_ids.add(str(snapshot['claimant_account_id']))
            if entry.get('found_item_id'):
                found_item_ids.add(str(entry['found_item_id']))

        profiles_by_id = {}
        if profile_ids:
            response = self.client.table('user_profiles').select(
                'account_id,fname,lname,email'
            ).in_('account_id', list(profile_ids)).execute()
            profiles_by_id = {str(row['account_id']): row for row in (response.data or [])}

        found_items_by_id = {}
        if found_item_ids:
            response = self.client.table('found_items').select(
                'item_id,item_name,fpost_id'
            ).in_('item_id', list(found_item_ids)).execute()
            found_items_by_id = {str(row['item_id']): row for row in (response.data or [])}

        mapped = []
        for entry in history:
            old_values = entry.get('old_values') or {}
            new_values = entry.get('new_values') or {}
            claimant_id = new_values.get('claimant_account_id') or old_values.get('claimant_account_id')
            claimant = profiles_by_id.get(str(claimant_id)) or {}
            actor = profiles_by_id.get(str(entry.get('actor_account_id'))) or {}
            found_item = found_items_by_id.get(str(entry.get('found_item_id'))) or {}
            mapped.append({
                'id': str(entry.get('history_id')),
                'claimId': str(entry.get('claim_id')),
                'claimReference': entry.get('claim_reference') or '',
                'foundItemId': str(entry.get('found_item_id') or ''),
                'foundItemReference': entry.get('found_item_reference') or found_item.get('fpost_id') or '',
                'claimant': f"{claimant.get('fname') or ''} {claimant.get('lname') or ''}".strip() or 'Claimant unavailable',
                'item': found_item.get('item_name') or 'Found item unavailable',
                'actor': f"{actor.get('fname') or ''} {actor.get('lname') or ''}".strip() or actor.get('email') or 'System',
                'action': entry.get('action') or 'updated',
                'oldValues': old_values,
                'newValues': new_values,
                'changedAt': entry.get('changed_at') or '',
            })
        return mapped

    def delete_admin_claim(self, claim_id: str, admin_account_id: str) -> Dict[str, Any]:
        """Archive a claim in the recycle bin, delete it through the Superadmin-validated database RPC, then remove the stored originals."""
        archive_id = self._archive_before_delete('claim', claim_id, admin_account_id)
        try:
            response = self.client.rpc('admin_delete_claim', {
                'p_claim_id': claim_id,
                'p_admin_id': admin_account_id,
            }).execute()
        except Exception:
            self._undo_archive(archive_id)
            raise
        deleted_claim = response.data
        if isinstance(deleted_claim, list):
            deleted_claim = deleted_claim[0] if deleted_claim else None
        if not deleted_claim:
            self._undo_archive(archive_id)
            raise RuntimeError(f"No claim row was deleted for claim_id={claim_id}")

        claim = self._decrypt_claim_sensitive_fields(deleted_claim) or deleted_claim
        proof_path = claim.get('proof_image_path') or self._legacy_claim_storage_path(claim.get('proof_image_url'), 'claim-proof-images')
        identity_path = claim.get('identity_document_path')
        for bucket, path in (('claim-proof-images', proof_path), ('claim-id-documents', identity_path)):
            if not path:
                continue
            try:
                self.client.storage.from_(bucket).remove([path])
            except Exception as error:
                logger.warning('Claim %s deleted, but stored object cleanup failed for bucket %s: %s', claim_id, bucket, error)

        return deleted_claim

    def _log_claim_step(self, claim: Dict[str, Any], status: str, actor_id: str, reason: Optional[str]) -> None:
        """Write the approval, release or rejection to the item's handover log (best effort)."""
        event = {'approved_for_pickup': 'claim_approved', 'collected': 'released', 'rejected': 'claim_rejected'}.get(status)
        if not event or not isinstance(claim, dict) or not claim.get('found_item_id'):
            return
        try:
            profile = self.get_user_by_account_id(str(actor_id)) or {}
        except Exception:
            profile = {}
        reference = claim.get('claim_reference') or 'the claim'
        detail = {'claim_approved': f'Claim {reference} was approved for pickup.', 'released': f'Released to the owner (claim {reference}).',
                  'claim_rejected': (reason or '').strip() or f'Claim {reference} was rejected.'}[event]
        custody_log.record(self.client, claim['found_item_id'], event, actor_id, f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip(), detail)

    def update_claim_status(self, claim_id: str, status: str, admin_account_id: str, rejection_reason: str = None) -> Dict[str, Any]:
        try:
            normalized = normalize_claim_status(status)
            if normalized not in {'approved_for_pickup', 'rejected', 'collected'}:
                raise ValueError(f"Invalid claim status: {status}")
            response = self.client.rpc('admin_update_claim_status', {
                'p_claim_id': claim_id,
                'p_status': normalized,
                'p_admin_id': admin_account_id,
                'p_rejection_reason': rejection_reason,
            }).execute()
            updated_claim = response.data
            if isinstance(updated_claim, list):
                updated_claim = updated_claim[0] if updated_claim else None
            if not updated_claim:
                raise RuntimeError(f"No claim row was updated for claim_id={claim_id}")
            if normalized == 'collected':
                # The item is released: finish the reports around it (the lost report, and tell the finder). Never undoes the release.
                ReportLifecycle(self).complete_for_claim(claim_id)
            self._log_claim_step(updated_claim, normalized, admin_account_id, rejection_reason)
            return updated_claim
        except Exception as e:
            try:
                existing_response = self.client.table('claims').select(
                    'claim_id,status,updated_at,reviewed_at,collected_at,rejection_reason'
                ).eq('claim_id', claim_id).limit(1).execute()
                existing_claim = (existing_response.data or [None])[0]
                if existing_claim and normalize_claim_status(existing_claim.get('status')) == normalized:
                    logger.info(
                        "Claim status update was already applied: claim_id=%s status=%s",
                        claim_id,
                        normalized,
                    )
                    return existing_claim
            except Exception as read_error:
                logger.warning(
                    "Unable to reconcile claim status after update error for claim_id=%s: %s",
                    claim_id,
                    read_error,
                )
            logger.exception("✗ Error updating claim status for claim_id=%s status=%s: %s", claim_id, status, repr(e))
            raise

    def confirm_ai_match_and_notify(self, missing_item_id: str, found_item_id: str, confirmed_by_account_id: str = None) -> Dict[str, Any]:
        """Confirm an AI match, save status to database, and send a notification to the missing item reporter"""
        try:
            # Fetch missing item details by POST ID
            missing_response = self.client.table('missing_items').select(
                'item_id, mpost_id, account_id, reporter_account_id, item_name'
            ).eq('mpost_id', missing_item_id).single().execute()
            missing_item = missing_response.data
            if not missing_item:
                raise ValueError(f"Missing item not found: {missing_item_id}")

            # Get the reporter account ID (prefer reporter_account_id, fall back to account_id)
            reporter_account_id = missing_item.get('reporter_account_id') or missing_item.get('account_id')
            if not reporter_account_id:
                raise ValueError(f"Reporter not found for missing item: {missing_item_id}")

            # Fetch found item details by POST ID
            found_response = self.client.table('found_items').select(
                'item_id, fpost_id, item_name'
            ).eq('fpost_id', found_item_id).single().execute()
            found_item = found_response.data
            if not found_item:
                raise ValueError(f"Found item not found: {found_item_id}")

            # Save the match confirmation to ai_matches table
            confirmed_at = self._utc_now_iso()
            match_payload = {
                'missing_item_id': missing_item.get('item_id'),
                'found_item_id': found_item.get('item_id'),
                'status': 'confirmed',
                'confirmed_by': confirmed_by_account_id,
                'confirmed_at': confirmed_at,
            }
            match_response = self.client.table('ai_matches').insert(match_payload).execute()
            # A confirmed match means the item has been found: the lost report says so until the item is released (then it is Completed).
            try:
                self.client.table('missing_items').update({'status': 'found', 'updated_at': self._utc_now_iso()}) \
                    .eq('item_id', missing_item.get('item_id')).eq('status', 'missing').execute()
            except Exception as status_error:
                logger.warning('Lost report status was not updated after a confirmed match: %s', status_error)

            admin_name = 'Admin'
            if confirmed_by_account_id:
                admin_profile = self.get_user_by_account_id(confirmed_by_account_id)
                if admin_profile:
                    admin_name = f"{admin_profile.get('fname') or ''} {admin_profile.get('lname') or ''}".strip() or admin_profile.get('email') or 'Admin'

            self.log_user_activity(
                account_id=str(confirmed_by_account_id or 'admin'),
                user_name=admin_name,
                action='Match Confirmed',
                module='AI Matching',
                target_name=f"{missing_item.get('mpost_id') or missing_item.get('item_id') or 'Missing item'} ↔ {found_item.get('fpost_id') or found_item.get('item_id') or 'Found item'}",
                target_id=f"{missing_item_id}:{found_item_id}",
                result='Success',
                metadata={'match_status': 'confirmed', 'missing_item_id': missing_item_id, 'found_item_id': found_item_id, 'confirmed_at': confirmed_at}
            )

            # Create notification for the missing item reporter
            missing_item_name = missing_item.get('item_name') or 'your item'
            found_item_name = found_item.get('item_name') or 'a found item'

            # Store the actual UUID item IDs in the notification, not the POST IDs
            notification = self.create_user_notification(
                user_account_id=reporter_account_id,
                title='Possible match found',
                message=f'A comparison of your missing item report for "{missing_item_name}" matches the found item "{found_item_name}". Review the details and submit a claim to continue.',
                found_item_id=found_item.get('item_id'),  # UUID
                missing_report_id=missing_item.get('item_id'),  # UUID
                notification_type='match_confirmation'
            )

            # Email the affected reporter too, so they hear about it without opening the app. Never undoes the confirmation.
            email_sent = False
            try:
                reporter = self.get_user_by_account_id(str(reporter_account_id)) or {}
                if reporter.get('email'):
                    from app.utils.email_service import send_reference_email_best_effort
                    email_sent = bool(send_reference_email_best_effort(
                        to_email=reporter.get('email'),
                        recipient_name=str(reporter.get('fname') or '').strip(),
                        subject='A possible match was found for your missing item',
                        summary=(f'An administrator confirmed that a found item may be yours: "{found_item_name}". '
                                 'Open E-Balik, review the details and submit a claim. Bring your original ID to the Lost and Found Office for in-person verification.'),
                        reference_label='Missing report reference',
                        reference=str(missing_item.get('mpost_id') or missing_item_id),
                        details={'Your item': missing_item_name, 'Found item reference': str(found_item.get('fpost_id') or found_item_id)},
                    ))
            except Exception as email_error:
                logger.warning(f'AI match email was not sent: {email_error}')

            return {
                'success': True,
                'match_id': match_response.data[0].get('match_id') if match_response.data else None,
                'notification_id': notification.get('notification_id'),
                'email_sent': email_sent,
                'message': 'Match confirmed. The user was notified in the app and by email.' if email_sent else 'Match confirmed and the user was notified in the app. The email could not be sent.'
            }
        except Exception as e:
            logger.exception(f"✗ Error confirming AI match and notifying: {e}")
            raise

    def reject_ai_match(self, missing_item_id: str, found_item_id: str, rejected_by_account_id: str = None) -> Dict[str, Any]:
        """Reject an AI match and save status to database"""
        try:
            # Fetch missing item details by POST ID
            missing_response = self.client.table('missing_items').select(
                'item_id, mpost_id, account_id, reporter_account_id, item_name'
            ).eq('mpost_id', missing_item_id).single().execute()
            missing_item = missing_response.data
            if not missing_item:
                raise ValueError(f"Missing item not found: {missing_item_id}")

            # Fetch found item details by POST ID
            found_response = self.client.table('found_items').select(
                'item_id, fpost_id, item_name'
            ).eq('fpost_id', found_item_id).single().execute()
            found_item = found_response.data
            if not found_item:
                raise ValueError(f"Found item not found: {found_item_id}")

            # Save the match rejection to ai_matches table
            rejected_at = self._utc_now_iso()
            match_payload = {
                'missing_item_id': missing_item.get('item_id'),
                'found_item_id': found_item.get('item_id'),
                'status': 'rejected',
                'rejected_by': rejected_by_account_id,
                'rejected_at': rejected_at,
            }
            match_response = self.client.table('ai_matches').insert(match_payload).execute()
            # If that was the only confirmed match, the lost report is searching again.
            try:
                # Changing their mind about a pair they confirmed earlier: the old confirmation no longer counts.
                self.client.table('ai_matches').update({'status': 'rejected', 'rejected_by': rejected_by_account_id, 'rejected_at': rejected_at}) \
                    .eq('missing_item_id', missing_item.get('item_id')).eq('found_item_id', found_item.get('item_id')).eq('status', 'confirmed').execute()
                still_confirmed = self.client.table('ai_matches').select('match_id').eq('missing_item_id', missing_item.get('item_id')).eq('status', 'confirmed').limit(1).execute().data
                if not still_confirmed:
                    self.client.table('missing_items').update({'status': 'missing', 'updated_at': self._utc_now_iso()}) \
                        .eq('item_id', missing_item.get('item_id')).eq('status', 'found').execute()
            except Exception as status_error:
                logger.warning('Lost report status was not restored after a rejected match: %s', status_error)

            admin_name = 'Admin'
            if rejected_by_account_id:
                admin_profile = self.get_user_by_account_id(rejected_by_account_id)
                if admin_profile:
                    admin_name = f"{admin_profile.get('fname') or ''} {admin_profile.get('lname') or ''}".strip() or admin_profile.get('email') or 'Admin'

            self.log_user_activity(
                account_id=str(rejected_by_account_id or 'admin'),
                user_name=admin_name,
                action='Match Rejected',
                module='AI Matching',
                target_name=f"{missing_item.get('mpost_id') or missing_item.get('item_id') or missing_item_id} ↔ {found_item.get('fpost_id') or found_item.get('item_id') or found_item_id}",
                target_id=f"{missing_item_id}:{found_item_id}",
                result='Warning',
                metadata={'match_status': 'rejected', 'missing_item_id': missing_item_id, 'found_item_id': found_item_id, 'rejected_at': rejected_at}
            )

            reporter_account_id = missing_item.get('reporter_account_id') or missing_item.get('account_id')
            notification = self.create_user_notification(
                user_account_id=reporter_account_id,
                title='Match not confirmed',
                message=f'The possible match between your missing item "{missing_item.get("item_name") or missing_item_id}" and found item "{found_item.get("item_name") or found_item_id}" was rejected after review. You can continue checking new found-item reports.',
                found_item_id=found_item.get('item_id'),
                missing_report_id=missing_item.get('item_id'),
                notification_type='match_rejection',
                link_label=None,
                link_page=None,
            )

            return {
                'success': True,
                'match_id': match_response.data[0].get('match_id') if match_response.data else None,
                'notification_id': notification.get('notification_id'),
                'message': 'Match rejected'
            }
        except Exception as e:
            logger.exception(f"✗ Error rejecting AI match: {e}")
            raise

    def create_user_notification(self, user_account_id: str, title: str, message: str, found_item_id: str = None, missing_report_id: str = None, notification_type: str = 'match_confirmation', link_label: str = 'Submit a claim', link_page: str = 'claim') -> Dict[str, Any]:
        """Create a user notification"""
        try:
            payload = {
                'user_account_id': user_account_id,
                'title': title,
                'message': message,
                'notification_type': notification_type,
                'is_read': False,
                'found_item_id': found_item_id,
                'missing_report_id': missing_report_id,
                'link_label': link_label,
                'link_page': link_page,
                'created_at': self._utc_now_iso(),
            }
            response = self.client.table('user_notifications').insert(payload).execute()
            if not response.data:
                raise RuntimeError("Failed to create notification")
            return response.data[0]
        except Exception as e:
            logger.exception(f"✗ Error creating notification: {e}")
            raise

    def get_user_notifications(self, user_account_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get notifications for a user, ordered by creation date (newest first)"""
        try:
            response = self.client.table('user_notifications').select(
                'notification_id, title, message, notification_type, is_read, found_item_id, missing_report_id, link_label, link_page, created_at, read_at'
            ).eq('user_account_id', user_account_id).order('created_at', desc=True).limit(limit).execute()
            notifications = response.data or []
            # The claim form wants the readable reference (FP2031), not the internal id the notification stores.
            item_ids = list({str(n['found_item_id']) for n in notifications if n.get('found_item_id')})
            references: Dict[str, str] = {}
            if item_ids:
                try:
                    rows = self.client.table('found_items').select('item_id,fpost_id').in_('item_id', item_ids).execute().data or []
                    references = {str(row['item_id']): row.get('fpost_id') or '' for row in rows}
                except Exception as lookup_error:
                    logger.warning('Notification references unavailable: %s', lookup_error)
            for notification in notifications:
                notification['found_item_reference'] = references.get(str(notification.get('found_item_id') or ''), '')
            return notifications
        except Exception as e:
            logger.error(f"✗ Error fetching notifications: {e}")
            return []

    def mark_notification_as_read(self, notification_id: str, user_account_id: str = None) -> Dict[str, Any]:
        """Mark a notification as read. With `user_account_id` only that person's own notification can be changed."""
        try:
            payload = {
                'is_read': True,
                'read_at': self._utc_now_iso(),
            }
            query = self.client.table('user_notifications').update(payload).eq('notification_id', notification_id)
            if user_account_id:
                query = query.eq('user_account_id', user_account_id)
            response = query.execute()
            if not response.data:
                raise RuntimeError(f"No notification found: {notification_id}")
            return response.data[0]
        except Exception as e:
            logger.exception(f"✗ Error marking notification as read: {e}")
            raise

    def get_unread_notification_count(self, user_account_id: str) -> int:
        """Get count of unread notifications for a user"""
        try:
            response = self.client.table('user_notifications').select('notification_id', count='exact').eq('user_account_id', user_account_id).eq('is_read', False).execute()
            return response.count or 0
        except Exception as e:
            logger.error(f"✗ Error getting unread notification count: {e}")
            return 0

    def health_check(self) -> bool:
        """Test database connection"""
        try:
            response = self.client.table('user_profiles').select('count', count='exact').limit(0).execute()
            logger.info("✓ Database health check passed")
            return True
        except Exception as e:
            logger.error(f"✗ Database health check failed: {e}")
            return False

# Singleton instance
_db_instance: Optional[SupabaseDB] = None

def get_db(url: str = None, service_key: str = None) -> SupabaseDB:
    """Get or create Supabase database instance"""
    global _db_instance
    if _db_instance is None:
        if not url or not service_key:
            raise ValueError("Supabase URL and Service Key are required")
        _db_instance = SupabaseDB(url, service_key)
    return _db_instance
