"""Campus report publication review; never changes custody or claim status."""
from flask import Blueprint,current_app,jsonify,request
from app.utils import get_db
from app.utils import report_publication
from Admin.Backend.shared.admin_access import _require_admin

report_publication_bp=Blueprint('admin_report_publication',__name__)


@report_publication_bp.route('/report-publication',methods=['GET','POST'])
def publication_review():
    actor=None
    try:
        actor=_require_admin()
        db=get_db(url=current_app.config['SUPABASE_URL'],service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if request.method=='GET':
            offset=int(request.args.get('offset','0'))
            if not 0<=offset<=900: raise ValueError('Narrow the filters to review older reports')
            result=report_publication.list_reports(db,request.args.get('kind','all'),request.args.get('state','pending'),
                request.args.get('category','')[:80],request.args.get('q','')[:100],offset)
        else:
            body=request.get_json(silent=True) or {}
            result=report_publication.review(db,actor,body.get('kind'),body.get('item_id'),body)
        reply=jsonify(result)
        reply.headers['Cache-Control']='no-store'
        return reply
    except PermissionError as error: return jsonify(error=str(error)),403
    except ValueError as error: return jsonify(error=str(error)),401 if actor is None else 400
    except Exception:
        current_app.logger.warning('Report publication request unavailable')
        return jsonify(error='Report changed or review setup is unavailable. Refresh before trying again.'),409
