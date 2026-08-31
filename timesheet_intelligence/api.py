import frappe
from frappe import _
from frappe.utils import now_datetime, getdate, get_datetime, format_datetime
import json

@frappe.whitelist(allow_guest=True)
def register_device(device_uuid, device_name="Unknown Device", user=None, employee_name=None, os_info=None):
	"""Register or authenticate a local developer machine token."""
	if not device_uuid:
		frappe.throw(_("Device UUID is required"))
	
	if not user:
		user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
	
	if not employee_name:
		if frappe.db.table_exists("Employee"):
			employee = frappe.db.get_value("Employee", {"user_id": user}, ["employee_name", "name"], as_dict=True)
			employee_name = employee.employee_name if employee else (frappe.db.get_value("User", user, "full_name") or user)
		else:
			employee_name = frappe.db.get_value("User", user, "full_name") or user
	
	token_name = f"TOKEN-{device_uuid}"
	if frappe.db.exists("Agent Device Token", token_name):
		doc = frappe.get_doc("Agent Device Token", token_name)
		doc.device_name = device_name
		doc.user = user
		doc.employee_name = employee_name
		if os_info:
			doc.os_info = os_info
		doc.last_sync_timestamp = now_datetime()
		doc.is_active = 1
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({
			"doctype": "Agent Device Token",
			"device_uuid": device_uuid,
			"device_name": device_name,
			"user": user,
			"employee_name": employee_name,
			"os_info": os_info or "Unknown",
			"last_sync_timestamp": now_datetime(),
			"is_active": 1
		})
		doc.insert(ignore_permissions=True)
	
	frappe.db.commit()
	return {
		"status": "success",
		"message": _("Device token registered successfully"),
		"token": doc.name,
		"user": doc.user,
		"employee_name": doc.employee_name
	}

@frappe.whitelist(allow_guest=True)
def sync_time_logs(device_uuid, logs):
	"""Ingest time log events from the local background daemon/watcher."""
	if not device_uuid:
		frappe.throw(_("Device UUID is required"))
	
	token_name = f"TOKEN-{device_uuid}"
	device_doc = frappe.db.get_value("Agent Device Token", token_name, ["name", "user", "employee_name", "is_active"], as_dict=True)
	
	if not device_doc or not device_doc.is_active:
		# Auto-register if not found
		register_device(device_uuid=device_uuid, device_name="Auto Registered Device")
		device_doc = frappe.db.get_value("Agent Device Token", token_name, ["name", "user", "employee_name", "is_active"], as_dict=True)

	if isinstance(logs, str):
		logs = json.loads(logs)

	saved_logs = []
	for log_entry in logs:
		session_id = log_entry.get("session_id") or log_entry.get("conversation_id") or frappe.generate_hash(length=12)
		project_name = log_entry.get("project_name") or log_entry.get("project_identifier") or "General Operations"
		from_time = log_entry.get("from_time")
		to_time = log_entry.get("to_time") or now_datetime()
		duration_minutes = float(log_entry.get("duration_minutes") or 0)
		
		if duration_minutes == 0 and from_time and to_time:
			diff = (get_datetime(to_time) - get_datetime(from_time)).total_seconds() / 60.0
			duration_minutes = max(1.0, round(diff, 1))

		total_hours = round(duration_minutes / 60.0, 2)
		
		summary_part_a = log_entry.get("summary_part_a") or log_entry.get("summary") or ""
		steps_part_b = log_entry.get("steps_part_b") or log_entry.get("details") or ""
		
		# Synthesize fallback if not provided
		if not summary_part_a and log_entry.get("work_items"):
			items = log_entry.get("work_items")
			if isinstance(items, list):
				summary_part_a = f"**I have** completed work on {project_name}: " + "; ".join(items)
				steps_part_b = "\n".join([f"* **I have** {item}" for item in items])
		
		session_doc = frappe.get_doc({
			"doctype": "Antigravity Session Log",
			"session_id": session_id,
			"project_name": project_name,
			"employee_name": log_entry.get("employee_name") or device_doc.employee_name,
			"user": device_doc.user,
			"device_token": device_doc.name,
			"mode": log_entry.get("mode", "Automatic"),
			"status": log_entry.get("status", "Completed"),
			"from_time": from_time or now_datetime(),
			"to_time": to_time,
			"duration_minutes": duration_minutes,
			"total_hours": total_hours,
			"summary_part_a": summary_part_a,
			"steps_part_b": steps_part_b,
			"git_commits": json.dumps(log_entry.get("git_commits", []), indent=2),
			"files_touched": json.dumps(log_entry.get("files_touched", []), indent=2),
			"raw_work_items": json.dumps(log_entry.get("work_items", []), indent=2)
		})
		session_doc.insert(ignore_permissions=True)
		saved_logs.append(session_doc.name)

	# Update last sync timestamp on device
	frappe.db.set_value("Agent Device Token", token_name, "last_sync_timestamp", now_datetime())
	frappe.db.commit()

	return {
		"status": "success",
		"synced_count": len(saved_logs),
		"saved_logs": saved_logs
	}

@frappe.whitelist(allow_guest=True)
def get_daily_summary(date=None, employee_name=None):
	"""Generate on-demand developer formatted Part A and Part B timesheet for any date."""
	if not date:
		date = getdate()
	
	filters = {"from_time": ["between", [f"{date} 00:00:00", f"{date} 23:59:59"]]}
	if employee_name:
		filters["employee_name"] = employee_name

	logs = frappe.get_all(
		"Antigravity Session Log",
		filters=filters,
		fields=["name", "session_id", "project_name", "employee_name", "from_time", "to_time", "duration_minutes", "total_hours", "summary_part_a", "steps_part_b"],
		order_by="from_time asc"
	)

	total_mins = sum(float(l.duration_minutes or 0) for l in logs)
	total_hrs = round(total_mins / 60.0, 2)
	hrs_part = int(total_mins // 60)
	mins_part = int(total_mins % 60)
	duration_str = f"{hrs_part} hrs {mins_part} mins" if hrs_part > 0 else f"{mins_part} mins"

	summary_a_parts = [l.summary_part_a for l in logs if l.summary_part_a]
	consolidated_a = "; ".join(summary_a_parts) if summary_a_parts else f"**I have** logged {duration_str} across {len(logs)} active work sessions on {date}."

	steps_b_parts = []
	for l in logs:
		from_fmt = format_datetime(l.from_time, "hh:mm a") if l.from_time else ""
		to_fmt = format_datetime(l.to_time, "hh:mm a") if l.to_time else ""
		time_tag = f"[{from_fmt} – {to_fmt}]" if from_fmt and to_fmt else ""
		if l.steps_part_b:
			steps_b_parts.append(f"* **{time_tag} {l.project_name}**:\n" + l.steps_part_b)
		elif l.summary_part_a:
			steps_b_parts.append(f"* **{time_tag}** — {l.summary_part_a}")

	consolidated_b = "\n".join(steps_b_parts)

	return {
		"date": str(date),
		"employee_name": employee_name or "All Employees",
		"total_sessions": len(logs),
		"total_minutes": total_mins,
		"total_hours": total_hrs,
		"duration_display": duration_str,
		"part_a": consolidated_a,
		"part_b": consolidated_b,
		"logs": logs
	}

@frappe.whitelist(allow_guest=True)
def switch_user(device_uuid, new_user):
	"""Instantly switch active user session on the developer machine."""
	if not device_uuid or not new_user:
		frappe.throw(_("Device UUID and new user are required"))
	
	token_name = f"TOKEN-{device_uuid}"
	if not frappe.db.exists("Agent Device Token", token_name):
		register_device(device_uuid, user=new_user)
	else:
		if frappe.db.table_exists("Employee"):
			employee = frappe.db.get_value("Employee", {"user_id": new_user}, ["employee_name"], as_dict=True)
			employee_name = employee.employee_name if employee else (frappe.db.get_value("User", new_user, "full_name") or new_user)
		else:
			employee_name = frappe.db.get_value("User", new_user, "full_name") or new_user
		frappe.db.set_value("Agent Device Token", token_name, {
			"user": new_user,
			"employee_name": employee_name,
			"last_sync_timestamp": now_datetime()
		})
		frappe.db.commit()
	
	return {
		"status": "success",
		"message": _("Device user switched successfully to {0}").format(new_user)
	}
