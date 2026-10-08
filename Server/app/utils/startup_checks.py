"""Refuse to start a production server that is not safe.

A server with a missing or default secret still runs, which is the dangerous part: tokens signed with a published default can be forged,
and data encrypted with a built-in fallback key is readable by anyone who has the code. In production those are startup errors, not
warnings in a health page nobody opens.
"""
import logging
import os
from typing import List

logger = logging.getLogger(__name__)

WEAK_JWT_SECRETS = ('', 'dev-secret-key-change-in-production')
MIN_JWT_SECRET_LENGTH = 24
REQUIRED = ('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET_KEY', 'APP_ENCRYPTION_KEY')


def production_problems(env=None) -> List[str]:
    """Everything wrong with the settings, as plain sentences. Empty when the server is safe to start."""
    env = os.environ if env is None else env
    problems: List[str] = []
    for name in REQUIRED:
        if not str(env.get(name) or '').strip():
            problems.append(f'{name} is not set.')
    secret = str(env.get('JWT_SECRET_KEY') or '').strip()
    if secret and (secret in WEAK_JWT_SECRETS or len(secret) < MIN_JWT_SECRET_LENGTH):
        problems.append(f'JWT_SECRET_KEY is the development default or shorter than {MIN_JWT_SECRET_LENGTH} characters.')
    origins = str(env.get('CORS_ORIGINS') or '').strip()
    if not origins:
        problems.append('CORS_ORIGINS is not set, so no website can call the API.')
    return problems


def assert_production_ready(config_name: str, testing: bool = False, env=None) -> None:
    """Raise RuntimeError listing every problem when a production server is misconfigured.

    ALLOW_INSECURE_START=true is an emergency switch that turns the error into a loud warning; remove it as soon as the settings are fixed.
    """
    if config_name != 'production' or testing:
        return
    environment = os.environ if env is None else env
    problems = production_problems(environment)
    if not problems:
        return
    message = 'E-Balik will not start in production: ' + ' '.join(problems) + ' Set them in the Render dashboard (Environment) and redeploy.'
    if str(environment.get('ALLOW_INSECURE_START') or '').strip().lower() in ('1', 'true', 'yes'):
        logger.critical('%s ALLOW_INSECURE_START is on, so the server starts anyway. Fix the settings and turn it off.', message)
        return
    raise RuntimeError(message)
