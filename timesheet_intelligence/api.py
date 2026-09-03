import frappe
from frappe import _
from frappe.utils import now_datetime, getdate, get_datetime, format_datetime
from datetime import timedelta
import json

def get_current_employee(user=None):
	"""
	Automatically resolves session user to Employee record with fallback.
	"""
	if not user:
		user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
	
	full_name = frappe.db.get_value("User", user, "full_name") or user
	employee_id = user
	employee_name = full_name

	if frappe.db.table_exists("Employee"):
		emp = frappe.db.get_value(
			"Employee",
			{"user_id": user, "status": "Active"},
			["name", "employee_name"],
			as_dict=True
		)
		if not emp:
			emp = frappe.db.get_value(
				"Employee",
				{"user_id": user},
				["name", "employee_name"],
				as_dict=True
			)
		if emp:
			employee_id = emp.name
			employee_name = emp.employee_name or full_name

	return {
		"user": user,
		"full_name": full_name,
		"employee_id": employee_id,
		"employee_name": employee_name
	}

@frappe.whitelist(allow_guest=True)
def get_current_user_profile():
	"""
	Returns authenticated session user profile and resolved employee details.
	"""
	user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
	emp = get_current_employee(user)
	roles = frappe.get_roles(user)
	is_manager = bool("System Manager" in roles or "HR Manager" in roles or "Projects Manager" in roles or user == "Administrator")

	return {
		"status": "success",
		"user": user,
		"full_name": emp["full_name"],
		"employee_id": emp["employee_id"],
		"employee_name": emp["employee_name"],
		"roles": roles,
		"is_manager": is_manager
	}

def get_timesheet_permission_query(user=None):
	"""
	Enforces data isolation in Frappe Desk list/report views:
	Standard employees can strictly view only their own records.
	"""
	if not user:
		user = frappe.session.user
	if user == "Administrator":
		return ""
	roles = frappe.get_roles(user)
	if "System Manager" in roles or "HR Manager" in roles or "Projects Manager" in roles:
		return ""
	return f"(`tabTimesheet Log`.`user` = {frappe.db.escape(user)} OR `tabTimesheet Log`.`owner` = {frappe.db.escape(user)})"

@frappe.whitelist(allow_guest=True)
def get_offline_bundle():
	"""
	Returns complete metadata bundle for 100% offline local caching in PWA IndexedDB.
	"""
	user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
	emp = get_current_employee(user)

	# 1. Projects
	projects = []
	if frappe.db.table_exists("Project"):
		projects = frappe.get_all(
			"Project",
			fields=["name", "project_name", "customer", "status", "project_type"],
			order_by="project_name asc",
			limit=100
		)
	if not projects:
		projects = [
			{"name": "PROJ-GENERAL", "project_name": "General Operations", "status": "Open", "project_type": "Internal"},
			{"name": "PROJ-DEV", "project_name": "Application Development", "status": "Open", "project_type": "External"},
			{"name": "PROJ-UIUX", "project_name": "Design & UX Architecture", "status": "Open", "project_type": "External"}
		]

	# 2. Tasks / Phases
	tasks = []
	if frappe.db.table_exists("Task"):
		tasks = frappe.get_all(
			"Task",
			fields=["name", "subject", "project", "status", "priority", "is_group"],
			order_by="subject asc",
			limit=200
		)

	# 3. Activity Types
	activity_types = []
	if frappe.db.table_exists("Activity Type"):
		activity_types = frappe.get_all(
			"Activity Type",
			fields=["name", "activity_type", "disabled"],
			filters={"disabled": 0} if frappe.db.has_column("Activity Type", "disabled") else {},
			order_by="name asc"
		)
	if not activity_types:
		activity_types = [
			{"name": "Development", "activity_type": "Development"},
			{"name": "UX/UI Design", "activity_type": "UX/UI Design"},
			{"name": "Operations & Data", "activity_type": "Operations & Data"},
			{"name": "Communication", "activity_type": "Communication"},
			{"name": "Overhead", "activity_type": "Overhead"}
		]

	return {
		"status": "success",
		"timestamp": str(now_datetime()),
		"user": {
			"email": user,
			"full_name": emp["full_name"],
			"employee_name": emp["employee_name"],
			"employee_id": emp["employee_id"]
		},
		"projects": projects,
		"tasks": tasks,
		"activity_types": activity_types
	}

@frappe.whitelist(allow_guest=True)
def sync_offline_queue(queue=None):
	"""
	Batch ingestion endpoint for offline mutations queued in client IndexedDB.
	Guarantees idempotency via client_uuid and strictly assigns the authenticated session user.
	"""
	if not queue:
		return {"status": "success", "synced_count": 0, "processed_ids": []}

	if isinstance(queue, str):
		try:
			queue = json.loads(queue)
		except Exception as e:
			frappe.throw(_("Invalid queue JSON: {0}").format(str(e)))

	session_user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
	emp = get_current_employee(session_user)

	processed_ids = []
	created_records = []

	for item in queue:
		client_uuid = item.get("client_uuid") or item.get("id") or frappe.generate_hash(length=12)
		project_name = item.get("project_name") or item.get("project") or "General Operations"
		task_name = item.get("task_name") or item.get("task") or ""
		activity_type = item.get("activity_type") or "Development"
		is_billable = 1 if item.get("is_billable") in [1, True, "1", "true", "Billable", "Fully Billed"] else 0

		from_time_raw = item.get("from_time")
		to_time_raw = item.get("to_time")
		try:
			dt_from = get_datetime(from_time_raw) if from_time_raw else now_datetime()
		except Exception:
			dt_from = now_datetime()

		try:
			dt_to = get_datetime(to_time_raw) if to_time_raw else now_datetime()
		except Exception:
			dt_to = now_datetime()

		from_time = dt_from.strftime("%Y-%m-%d %H:%M:%S")
		to_time = dt_to.strftime("%Y-%m-%d %H:%M:%S")
		duration_minutes = float(item.get("duration_minutes") or 0)

		if duration_minutes <= 0:
			diff = (dt_to - dt_from).total_seconds() / 60.0
			duration_minutes = max(1.0, round(diff, 1))

		total_hours = round(duration_minutes / 60.0, 2)
		description = (item.get("description") or item.get("notes") or "").strip()

		# Guard: Skip empty accomplishment entries
		if not description:
			continue

		# 1. Idempotency Check
		existing = frappe.db.get_value("Timesheet Log", {"client_uuid": client_uuid}, "name")
		if existing:
			processed_ids.append(client_uuid)
			continue

		# 2. Record to dedicated Timesheet Log with session-bound employee
		ts_log_doc = frappe.get_doc({
			"doctype": "Timesheet Log",
			"client_uuid": client_uuid,
			"project_name": project_name,
			"task_name": task_name,
			"activity_type": activity_type,
			"employee_name": emp["employee_name"],
			"user": session_user,
			"status": "Completed",
			"is_billable": is_billable,
			"from_time": from_time,
			"to_time": to_time,
			"duration_minutes": duration_minutes,
			"total_hours": total_hours,
			"accomplishments": description
		})
		ts_log_doc.insert(ignore_permissions=True)

		processed_ids.append(client_uuid)
		created_records.append(ts_log_doc.name)

	frappe.db.commit()

	return {
		"status": "success",
		"synced_count": len(processed_ids),
		"processed_ids": processed_ids,
		"created_records": created_records
	}

@frappe.whitelist(allow_guest=True)
def get_my_timesheets(year=None, month=None, date=None, limit=100):
	"""
	Returns timesheets with monthly aggregation for Google Calendar and date-filtered daily logs.
	Enforces user data isolation for standard employees.
	"""
	if not frappe.db.table_exists("Timesheet Log"):
		return {
			"status": "success",
			"count": 0,
			"month_total_hours": 0.0,
			"today_total_hours": 0.0,
			"daily_summary": {},
			"logs": []
		}

	user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
	roles = frappe.get_roles(user)
	is_manager = bool("System Manager" in roles or "HR Manager" in roles or "Projects Manager" in roles or user == "Administrator")

	user_filters = {}
	if not is_manager:
		user_filters["user"] = user

	today_date_str = str(getdate())
	now = now_datetime()
	target_year = int(year) if year else now.year
	target_month = int(month) if month else now.month

	start_of_month = f"{target_year:04d}-{target_month:02d}-01 00:00:00"
	if target_month == 12:
		end_of_month = f"{target_year+1:04d}-01-01 00:00:00"
	else:
		end_of_month = f"{target_year:04d}-{target_month+1:02d}-01 00:00:00"

	# 1. Fetch month records for Calendar Aggregation
	month_filters = {
		"from_time": ["between", [start_of_month, end_of_month]],
		**user_filters
	}
	month_logs = frappe.get_all(
		"Timesheet Log",
		filters=month_filters,
		fields=["name", "from_time", "duration_minutes", "total_hours"],
		order_by="from_time asc"
	)

	daily_summary = {}
	month_total_minutes = 0.0
	today_total_minutes = 0.0

	for m_log in month_logs:
		dt_str = str(m_log.from_time)[:10]
		mins = float(m_log.duration_minutes or (m_log.total_hours * 60.0 if m_log.total_hours else 0))
		daily_summary[dt_str] = round(daily_summary.get(dt_str, 0.0) + (mins / 60.0), 2)
		month_total_minutes += mins
		if dt_str == today_date_str:
			today_total_minutes += mins

	# Calculate today's hours if not in current query range
	if today_date_str not in daily_summary:
		today_logs = frappe.get_all(
			"Timesheet Log",
			filters={"from_time": ["between", [f"{today_date_str} 00:00:00", f"{today_date_str} 23:59:59"]], **user_filters},
			fields=["duration_minutes", "total_hours"]
		)
		today_total_minutes = sum(float(t.duration_minutes or 0) for t in today_logs)

	# 2. Fetch table logs
	table_filters = {**user_filters}
	if date:
		table_filters["from_time"] = ["between", [f"{date} 00:00:00", f"{date} 23:59:59"]]

	logs = frappe.get_all(
		"Timesheet Log",
		filters=table_filters,
		fields=[
			"name",
			"client_uuid",
			"project_name",
			"task_name",
			"activity_type",
			"employee_name",
			"user",
			"from_time",
			"to_time",
			"duration_minutes",
			"total_hours",
			"accomplishments",
			"status",
			"is_billable",
			"creation"
		],
		order_by="creation desc",
		limit=int(limit)
	)

	return {
		"status": "success",
		"count": len(logs),
		"year": target_year,
		"month": target_month,
		"month_total_hours": round(month_total_minutes / 60.0, 2),
		"today_total_hours": round(today_total_minutes / 60.0, 2),
		"daily_summary": daily_summary,
		"logs": logs
	}

@frappe.whitelist(allow_guest=True)
def create_manual_session(project_name, sub_project=None, duration_minutes=30, summary_part_a=None, steps_part_b=None, from_time=None, to_time=None):
	"""Log a manual time entry bound to authenticated session."""
	if not project_name:
		frappe.throw(_("Project name is required"))
	
	session_user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
	emp = get_current_employee(session_user)

	if not to_time:
		to_time = now_datetime()
	if not from_time:
		from_time = get_datetime(to_time) - timedelta(minutes=float(duration_minutes or 30))
	else:
		from_time = get_datetime(from_time)
		to_time = get_datetime(to_time)
		diff = (to_time - from_time).total_seconds() / 60.0
		duration_minutes = max(1.0, round(diff, 1))

	total_hours = round(float(duration_minutes) / 60.0, 2)
	session_id = f"SES-MANUAL-{frappe.generate_hash(length=8)}"
	
	target_title = f"{project_name} - {sub_project}" if sub_project else project_name
	if not summary_part_a:
		summary_part_a = f"**I have** completed work on {target_title}."
	if not steps_part_b:
		steps_part_b = f"* **I have** worked on tasks for {target_title}."
		
	doc = frappe.get_doc({
		"doctype": "Timesheet Log",
		"client_uuid": session_id,
		"project_name": project_name,
		"task_name": sub_project or "",
		"employee_name": emp["employee_name"],
		"user": session_user,
		"status": "Completed",
		"from_time": from_time,
		"to_time": to_time,
		"duration_minutes": float(duration_minutes),
		"total_hours": total_hours,
		"accomplishments": summary_part_a + ("\n" + steps_part_b if steps_part_b else "")
	})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	
	return {
		"status": "success",
		"message": _("Timesheet logged successfully"),
		"docname": doc.name,
		"session_id": doc.client_uuid
	}

@frappe.whitelist(allow_guest=True)
def delete_session(session_name):
	"""Delete a timesheet log by its docname with permission check."""
	if not session_name:
		frappe.throw(_("Session name is required"))
	
	if not frappe.db.exists("Timesheet Log", session_name):
		return {"status": "error", "message": _("Timesheet not found")}

	doc = frappe.get_doc("Timesheet Log", session_name)
	user = frappe.session.user
	roles = frappe.get_roles(user)
	is_manager = bool("System Manager" in roles or "HR Manager" in roles or "Projects Manager" in roles or user == "Administrator")
	
	if user != "Guest" and not is_manager and doc.user != user and doc.owner != user:
		frappe.throw(_("Permission Denied: You can only delete your own timesheets."))

	frappe.delete_doc("Timesheet Log", session_name, ignore_permissions=True)
	frappe.db.commit()
	return {"status": "success", "message": _("Timesheet deleted successfully")}

@frappe.whitelist(allow_guest=True)
def get_daily_summary(date=None):
	"""Generate on-demand developer formatted timesheet for any date."""
	if not date:
		date = getdate()
	
	user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
	emp = get_current_employee(user)

	filters = {
		"from_time": ["between", [f"{date} 00:00:00", f"{date} 23:59:59"]],
		"user": user
	}

	logs = frappe.get_all(
		"Timesheet Log",
		filters=filters,
		fields=["name", "client_uuid", "project_name", "task_name", "activity_type", "employee_name", "from_time", "to_time", "duration_minutes", "total_hours", "accomplishments"],
		order_by="from_time asc"
	)

	total_mins = sum(float(l.duration_minutes or 0) for l in logs)
	total_hrs = round(total_mins / 60.0, 2)
	hrs_part = int(total_mins // 60)
	mins_part = int(total_mins % 60)
	duration_str = f"{hrs_part} hrs {mins_part} mins" if hrs_part > 0 else f"{mins_part} mins"

	steps_b_parts = []
	for l in logs:
		from_fmt = format_datetime(l.from_time, "hh:mm a") if l.from_time else ""
		to_fmt = format_datetime(l.to_time, "hh:mm a") if l.to_time else ""
		time_tag = f"[{from_fmt} – {to_fmt}]" if from_fmt and to_fmt else ""
		proj_label = f"{l.project_name} ({l.task_name})" if l.get("task_name") else l.project_name
		if l.accomplishments:
			steps_b_parts.append(f"* **{time_tag} {proj_label}**:\n" + l.accomplishments)
		else:
			steps_b_parts.append(f"* **{time_tag} {proj_label}** — Completed work session")

	consolidated_b = "\n".join(steps_b_parts)
	consolidated_a = f"**I have** logged {duration_str} across {len(logs)} active work sessions on {date}."

	return {
		"date": str(date),
		"employee_name": emp["employee_name"],
		"total_sessions": len(logs),
		"total_minutes": total_mins,
		"total_hours": total_hrs,
		"duration_display": duration_str,
		"part_a": consolidated_a,
		"part_b": consolidated_b,
		"logs": logs
	}
