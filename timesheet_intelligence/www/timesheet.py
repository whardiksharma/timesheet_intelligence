import frappe
from frappe.utils import getdate, now_datetime

no_cache = 1

def get_context(context):
    selected_date = frappe.form_dict.get("date") or getdate()
    context.today_date = str(selected_date)
    context.is_today = (str(selected_date) == str(getdate()))
    
    logs = frappe.get_all(
        "Antigravity Session Log",
        filters={"from_time": ["between", [f"{selected_date} 00:00:00", f"{selected_date} 23:59:59"]]},
        fields=["name", "session_id", "project_name", "sub_project", "employee_name", "from_time", "to_time", "duration_minutes", "total_hours", "summary_part_a", "steps_part_b", "mode"],
        order_by="from_time desc"
    )
    
    total_mins = sum(float(l.duration_minutes or 0) for l in logs)
    hrs = int(total_mins // 60)
    mins = int(total_mins % 60)
    
    context.logs = logs
    context.total_sessions = len(logs)
    context.total_hours_display = f"{hrs} hrs {mins} mins" if hrs > 0 else f"{mins} mins"
    context.user_name = "Hardik Sharma"
    
    # Active devices count
    context.active_devices = frappe.db.count("Agent Device Token", {"is_active": 1})
    
    # Hierarchical Projects & Sub-Projects
    context.projects_hierarchy = {
        "Timesheet Intelligence": ["Web Portal Dashboard", "REST Ingestion APIs", "Watcher Daemon", "Database DocTypes", "UI & UX Styling", "Bug Fixes & Tests"],
        "Core Frappe Bench": ["Site Configuration", "Database Migrations", "Background Services", "Redis / SocketIO", "Performance Optimization"],
        "Website 2.0": ["Hero & Navigation", "Feature Cards", "Responsive Layout", "WCAG Accessibility", "Assets & Images"],
        "General Tasks": ["Code Review", "Investigation / Research", "Documentation", "Setup & Deployment"]
    }
    
    return context
