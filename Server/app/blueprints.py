"""API blueprint registry: mounts the page modules from Users/Backend and Admin/Backend."""


def register_blueprints(app):
    """Register all page blueprints with the Flask app"""
    # Users section — page blueprints carry full resource paths under /api
    from Users.Backend.home.routes import home_bp
    from Users.Backend.profile.routes import profile_bp
    from Users.Backend.found_item.routes import found_item_bp
    from Users.Backend.missing_item.routes import missing_item_bp
    from Users.Backend.my_reports.routes import my_reports_bp
    from Users.Backend.matches.routes import matches_bp
    from Users.Backend.browse_items.routes import browse_items_bp
    from Users.Backend.claim.routes import claims_bp
    from Users.Backend.notifications.routes import notifications_bp

    for blueprint in (home_bp, profile_bp, found_item_bp, missing_item_bp, my_reports_bp, matches_bp, browse_items_bp):
        app.register_blueprint(blueprint, url_prefix='/api')
    app.register_blueprint(claims_bp, url_prefix='/api/claims')
    app.register_blueprint(notifications_bp, url_prefix='/api/notifications')

    # Admin section — every admin page blueprint mounts at /api/admin
    from Admin.Backend.dashboard.routes import dashboard_bp
    from Admin.Backend.lost_items.routes import lost_items_bp
    from Admin.Backend.found_items.routes import found_items_bp
    from Admin.Backend.ai_matching.routes import ai_matching_bp
    from Admin.Backend.claims_verification.routes import claims_verification_bp
    from Admin.Backend.users.routes import users_bp
    from Admin.Backend.reports_analytics.routes import reports_analytics_bp
    from Admin.Backend.activity_logs.routes import activity_logs_bp
    from Admin.Backend.admin_profile.routes import admin_profile_bp

    for blueprint in (dashboard_bp, lost_items_bp, found_items_bp, ai_matching_bp, claims_verification_bp,
                      users_bp, reports_analytics_bp, activity_logs_bp, admin_profile_bp):
        app.register_blueprint(blueprint, url_prefix='/api/admin')
