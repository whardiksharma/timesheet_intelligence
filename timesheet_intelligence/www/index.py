import frappe
from frappe.utils import getdate, now_datetime

no_cache = 1

def get_context(context):
    date = getdate()
    context.today_date = str(date)
    
    logs = frappe.get_all(
        "Antigravity Session Log",
        filters={"from_time": ["between", [f"{date} 00:00:00", f"{date} 23:59:59"]]},
        fields=["name", "session_id", "project_name", "employee_name", "from_time", "to_time", "duration_minutes", "total_hours", "summary_part_a", "steps_part_b", "mode"],
        order_by="from_time desc"
    )
    
    total_mins = sum(float(l.duration_minutes or 0) for l in logs)
    hrs = int(total_mins // 60)
    mins = int(total_mins % 60)
    
    context.logs = logs
    context.total_sessions = len(logs)
    context.total_hours_display = f"{hrs} hrs {mins} mins" if hrs > 0 else f"{mins} mins"
    
    # Active devices count
    context.active_devices = frappe.db.count("Agent Device Token", {"is_active": 1})
    
    return context
