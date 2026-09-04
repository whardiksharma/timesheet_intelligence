import frappe
from frappe.utils import getdate, now_datetime

no_cache = 1

def get_context(context):
    # Enforce strict authentication for all visitors
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/timesheet"
        raise frappe.Redirect

    context.no_cache = 1
    context.user = frappe.session.user
    context.user_name = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
    
    selected_date = frappe.form_dict.get("date") or getdate()
    context.today_date = str(selected_date)
    context.is_today = (str(selected_date) == str(getdate()))
    
    logs = []
    if frappe.db.table_exists("Timesheet Log"):
        roles = frappe.get_roles(frappe.session.user)
        is_manager = bool("System Manager" in roles or "HR Manager" in roles or "Projects Manager" in roles or frappe.session.user == "Administrator")
        filters = {"from_time": ["between", [f"{selected_date} 00:00:00", f"{selected_date} 23:59:59"]]}
        if not is_manager:
            filters["user"] = frappe.session.user
            
        logs = frappe.get_all(
            "Timesheet Log",
            filters=filters,
            fields=["name", "client_uuid", "project_name", "task_name", "activity_type", "employee_name", "from_time", "to_time", "duration_minutes", "total_hours", "accomplishments", "status"],
            order_by="from_time desc"
        )
    
    total_mins = sum(float(l.duration_minutes or 0) for l in logs)
    hrs = int(total_mins // 60)
    mins = int(total_mins % 60)
    
    context.logs = logs
    context.total_sessions = len(logs)
    context.total_hours_display = f"{hrs} hrs {mins} mins" if hrs > 0 else f"{mins} mins"
    
    return context
