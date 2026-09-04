# Copyright (c) 2026, Timesheet Intelligence and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

class TimesheetLog(Document):
	def before_insert(self):
		if not self.user:
			self.user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
		if not self.employee_name:
			from timesheet_intelligence.api import get_current_employee
			emp = get_current_employee(self.user)
			self.employee_name = emp.get("employee_name")

	def validate(self):
		# 1. Mandatory Accomplishment Guard: strictly required upon completion
		if self.status == "Completed":
			if not self.accomplishments or not self.accomplishments.strip():
				frappe.throw(_("Accomplishments cannot be empty when completing a timesheet session. Please document what was completed."))

		# 2. Permission Guard: Prevent standard employees from creating or modifying logs for another user
		current_user = frappe.session.user
		roles = frappe.get_roles(current_user)
		is_manager = bool("System Manager" in roles or "HR Manager" in roles or "Projects Manager" in roles or current_user == "Administrator")
		
		if current_user != "Guest" and not is_manager:
			if self.user and self.user != current_user:
				frappe.throw(_("Permission Denied: You cannot create or modify timesheets for another employee."))
