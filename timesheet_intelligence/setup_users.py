import frappe
from frappe.utils.password import update_password, check_password

def grant_all_access():
    print("=== CONFIGURING PASSWORDS & PERMISSIONS FOR ALL USERS ===")
    
    user_passwords = {
        "hardiksharma80912@gmail.com": "ommnomi2",
        "nomeshwer@ommnomi.in": "OmmNoMi",
        "meenaxi@ommnomi.in": "ommnomi123",
        "neha@ommnomi.in": "ommnomi123",
    }
    
    for email, pwd in user_passwords.items():
        if not frappe.db.exists("User", email):
            print(f"Creating User: {email}")
            user_doc = frappe.get_doc({
                "doctype": "User",
                "email": email,
                "first_name": email.split("@")[0].capitalize(),
                "enabled": 1,
                "user_type": "System User",
                "send_welcome_email": 0
            })
            user_doc.insert(ignore_permissions=True)
        else:
            user_doc = frappe.get_doc("User", email)
            user_doc.enabled = 1
            user_doc.user_type = "System User"
            user_doc.save(ignore_permissions=True)

        # 1. Update Password in __Auth
        update_password(user=email, pwd=pwd, logout_all_sessions=False)
        print(f"✓ Password updated in __Auth for {email} -> '{pwd}'")

        # 2. Verify check_password
        try:
            check_password(email, pwd)
            print(f"  -> Authentication test PASSED for {email}")
        except Exception as e:
            print(f"  -> Authentication test FAILED for {email}: {e}")

    # Timesheet Log permissions
    if frappe.db.table_exists("DocPerm"):
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

    # Set default website homepage to timesheet
    try:
        frappe.db.set_single_value("Website Settings", "home_page", "timesheet")
        print("Updated Website Settings: home_page -> 'timesheet'")
    except Exception as e:
        print(f"Could not set home_page: {e}")

    frappe.db.commit()
    print("=== ALL USERS PROPERLY CONFIGURED & VERIFIED ===")

if __name__ == "__main__":
    grant_all_access()
