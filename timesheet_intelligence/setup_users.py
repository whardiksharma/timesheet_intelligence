import frappe

def grant_all_access():
    print("=== ENSURING DOCPERMS FOR USER AND TIMESHEET LOG ===")
    
    # Check User DocPerm
    # Frappe by default allows System Manager, and users can view their own profile.
    # Let's ensure Employee and Desk User have permission to read/write their own Timesheet Log
    if frappe.db.table_exists("DocPerm"):
        # Timesheet Log permissions
        roles_to_grant_timesheet = ["Employee", "Desk User", "All"]
        for role in roles_to_grant_timesheet:
            existing = frappe.db.get_value("Custom DocPerm", {"parent": "Timesheet Log", "role": role}) or \
                       frappe.db.get_value("DocPerm", {"parent": "Timesheet Log", "role": role})
            if not existing:
                try:
                    cdp = frappe.get_doc({
                        "doctype": "Custom DocPerm",
                        "parent": "Timesheet Log",
                        "parenttype": "DocType",
                        "parentfield": "permissions",
                        "role": role,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 1,
                        "if_owner": 1 if role != "System Manager" else 0
                    })
                    cdp.insert(ignore_permissions=True)
                    print(f"Added Custom DocPerm for Timesheet Log to {role}")
                except Exception as e:
                    print(f"Could not add DocPerm for {role}: {e}")

    frappe.db.commit()
    print("=== DOCPERMS UPDATED ===")

if __name__ == "__main__":
    grant_all_access()
