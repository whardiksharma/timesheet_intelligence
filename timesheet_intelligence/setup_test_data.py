import frappe
import uuid
from datetime import datetime, timedelta

def bootstrap():
    print("🚀 Starting Test User & Timesheet Data Bootstrap...")

    # 1. User Matrix Definition
    users_data = [
        {
            "email": "hardiksharma80912@gmail.com",
            "first_name": "Hardik",
            "last_name": "Sharma",
            "password": "ommnomi2",
            "roles": ["Employee", "System Manager"]
        },
        {
            "email": "nomeshwer@ommnomi.in",
            "first_name": "Nomeshwer",
            "last_name": "Sharma",
            "password": "OmmNoMi",
            "roles": ["Employee", "Projects Manager"]
        },
        {
            "email": "meenaxi@ommnomi.in",
            "first_name": "Meenaxi",
            "last_name": "Sharma",
            "password": "OmmNoMi",
            "roles": ["Employee"]
        },
        {
            "email": "neha@ommnomi.in",
            "first_name": "Neha",
            "last_name": "Sharma",
            "password": "OmmNoMi",
            "roles": ["Employee"]
        }
    ]

    has_employee_doctype = frappe.db.exists("DocType", "Employee")

    # 2. Create / Update Users & Linked Employees
    for u in users_data:
        email = u["email"]
        first_name = u["first_name"]
        last_name = u["last_name"]
        full_name = f"{first_name} {last_name}".strip()

        if frappe.db.exists("User", email):
            user_doc = frappe.get_doc("User", email)
            user_doc.first_name = first_name
            user_doc.last_name = last_name
            user_doc.full_name = full_name
            user_doc.enabled = 1
            user_doc.save(ignore_permissions=True)
            print(f"✓ Updated existing user: {email} ({full_name})")
        else:
            user_doc = frappe.get_doc({
                "doctype": "User",
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "full_name": full_name,
                "send_welcome_email": 0,
                "enabled": 1,
                "user_type": "System User"
            })
            user_doc.insert(ignore_permissions=True)
            print(f"✓ Created new user: {email} ({full_name})")

        # Set Password
        frappe.utils.password.update_password(user=email, pwd=u["password"])

        # Assign Roles
        for r in u["roles"]:
            if frappe.db.exists("Role", r):
                if not frappe.db.exists("Has Role", {"parent": email, "role": r}):
                    user_doc.add_roles(r)

        # Create/Link Employee Record if DocType exists
        if has_employee_doctype:
            emp_name = frappe.db.get_value("Employee", {"user_id": email}, "name")
            if not emp_name:
                emp_name = frappe.db.get_value("Employee", {"employee_name": full_name}, "name")

            if emp_name:
                emp_doc = frappe.get_doc("Employee", emp_name)
                emp_doc.user_id = email
                emp_doc.status = "Active"
                emp_doc.save(ignore_permissions=True)
                print(f"  ↳ Linked existing Employee record: {emp_name} to {email}")
            else:
                try:
                    emp_doc = frappe.get_doc({
                        "doctype": "Employee",
                        "first_name": first_name,
                        "last_name": last_name,
                        "employee_name": full_name,
                        "user_id": email,
                        "status": "Active",
                        "gender": "Female" if first_name in ["Meenaxi", "Neha"] else "Male",
                        "date_of_joining": "2024-01-01"
                    })
                    emp_doc.insert(ignore_permissions=True)
                    print(f"  ↳ Created new active Employee record: {emp_doc.name} for {email}")
                except Exception as emp_err:
                    print(f"  ⚠️ Could not create Employee record for {email}: {emp_err}")

    frappe.db.commit()

    # 3. Generate Realistic Timesheet Log Entries
    print("\n📊 Generating Realistic Timesheet Log Entries across all 4 users...")

    # Template seed activities
    log_templates = [
        # Hardik Sharma (Full Stack & Systems)
        {
            "user": "hardiksharma80912@gmail.com",
            "employee_name": "Hardik Sharma",
            "project_name": "Application Development",
            "task_name": "Offline Sync Engine",
            "activity_type": "Development",
            "accomplishments": "• Implemented AppSheet-style silent offline sync\n• Built dual-layer optimistic calculation engine\n• Isolated MariaDB savepoints for partial batch rollbacks",
            "date": "2026-09-04",
            "start_time": "09:00",
            "duration": 180 # 3.0h
        },
        {
            "user": "hardiksharma80912@gmail.com",
            "employee_name": "Hardik Sharma",
            "project_name": "Design & UX Architecture",
            "task_name": "3-Theme Design System",
            "activity_type": "UX/UI Design",
            "accomplishments": "• Added Google Material 3, Frappe, and Obsidian Dark themes\n• Built mobile 3-dot overflow menu for small screens",
            "date": "2026-09-04",
            "start_time": "14:00",
            "duration": 120 # 2.0h
        },
        {
            "user": "hardiksharma80912@gmail.com",
            "employee_name": "Hardik Sharma",
            "project_name": "Application Development",
            "task_name": "PWA Service Worker & IndexedDB",
            "activity_type": "Development",
            "accomplishments": "• Upgraded TimesheetPWA_DB schema to v2\n• Added atomic offline mutation queue and metadata stores",
            "date": "2026-09-02",
            "start_time": "10:00",
            "duration": 240 # 4.0h
        },
        {
            "user": "hardiksharma80912@gmail.com",
            "employee_name": "Hardik Sharma",
            "project_name": "General Operations",
            "task_name": "Sprint Architecture Review",
            "activity_type": "Communication",
            "accomplishments": "• Participated in sprint architecture review and tech debt triage",
            "date": "2026-08-28",
            "start_time": "11:00",
            "duration": 90 # 1.5h
        },
        {
            "user": "hardiksharma80912@gmail.com",
            "employee_name": "Hardik Sharma",
            "project_name": "Application Development",
            "task_name": "Voice Note Recognition API",
            "activity_type": "Development",
            "accomplishments": "• Integrated Web Speech API controller with keyboard shortcut (Shift+V)",
            "date": "2026-08-18",
            "start_time": "13:30",
            "duration": 150 # 2.5h
        },

        # Nomeshwer Sharma (Project Manager & Operations)
        {
            "user": "nomeshwer@ommnomi.in",
            "employee_name": "Nomeshwer Sharma",
            "project_name": "General Operations",
            "task_name": "Quarterly Milestone Planning",
            "activity_type": "Operations & Data",
            "accomplishments": "• Reviewed Q3 developer deliverables and timesheet accuracy\n• Planned upcoming ERPNext integration milestones",
            "date": "2026-09-04",
            "start_time": "09:30",
            "duration": 150 # 2.5h
        },
        {
            "user": "nomeshwer@ommnomi.in",
            "employee_name": "Nomeshwer Sharma",
            "project_name": "Application Development",
            "task_name": "Client Requirements Gathering",
            "activity_type": "Communication",
            "accomplishments": "• Met with stakeholders to finalize timesheet intelligence SLA criteria",
            "date": "2026-09-04",
            "start_time": "15:00",
            "duration": 90 # 1.5h
        },
        {
            "user": "nomeshwer@ommnomi.in",
            "employee_name": "Nomeshwer Sharma",
            "project_name": "General Operations",
            "task_name": "Team Standup & Backlog Grooming",
            "activity_type": "Communication",
            "accomplishments": "• Conducted weekly sprint standup and assigned tickets for PWA release",
            "date": "2026-09-01",
            "start_time": "10:00",
            "duration": 120 # 2.0h
        },
        {
            "user": "nomeshwer@ommnomi.in",
            "employee_name": "Nomeshwer Sharma",
            "project_name": "General Operations",
            "task_name": "Resource Allocation Review",
            "activity_type": "Operations & Data",
            "accomplishments": "• Analyzed monthly utilization metrics and workload distribution",
            "date": "2026-08-31",
            "start_time": "11:00",
            "duration": 180 # 3.0h
        },
        {
            "user": "nomeshwer@ommnomi.in",
            "employee_name": "Nomeshwer Sharma",
            "project_name": "Design & UX Architecture",
            "task_name": "Design System Sign-off",
            "activity_type": "UX/UI Design",
            "accomplishments": "• Approved Google Material 3 color tokens and mobile typography scales",
            "date": "2026-08-14",
            "start_time": "14:00",
            "duration": 120 # 2.0h
        },

        # Meenaxi Sharma (Lead Frontend & UX)
        {
            "user": "meenaxi@ommnomi.in",
            "employee_name": "Meenaxi Sharma",
            "project_name": "Design & UX Architecture",
            "task_name": "Component Elevation & Contrast",
            "activity_type": "UX/UI Design",
            "accomplishments": "• Refined WCAG 2.1 AA contrast ratios for light and dark themes\n• Styled Google Keep-inspired accomplishment input bar",
            "date": "2026-09-04",
            "start_time": "10:00",
            "duration": 180 # 3.0h
        },
        {
            "user": "meenaxi@ommnomi.in",
            "employee_name": "Meenaxi Sharma",
            "project_name": "Design & UX Architecture",
            "task_name": "Mobile Drawer & Sheet Navigation",
            "activity_type": "UX/UI Design",
            "accomplishments": "• Created responsive popover and bottom modal sheets for mobile",
            "date": "2026-09-04",
            "start_time": "14:30",
            "duration": 120 # 2.0h
        },
        {
            "user": "meenaxi@ommnomi.in",
            "employee_name": "Meenaxi Sharma",
            "project_name": "Application Development",
            "task_name": "Calendar Day Cell Highlighting",
            "activity_type": "Development",
            "accomplishments": "• Built visual attendance dots (green >=4h, amber <4h) in monthly grid",
            "date": "2026-09-03",
            "start_time": "11:00",
            "duration": 210 # 3.5h
        },
        {
            "user": "meenaxi@ommnomi.in",
            "employee_name": "Meenaxi Sharma",
            "project_name": "Design & UX Architecture",
            "task_name": "SVG Icons & Vector Assets",
            "activity_type": "UX/UI Design",
            "accomplishments": "• Designed custom theme icons and stopwatch visual indicators",
            "date": "2026-08-25",
            "start_time": "13:00",
            "duration": 180 # 3.0h
        },
        {
            "user": "meenaxi@ommnomi.in",
            "employee_name": "Meenaxi Sharma",
            "project_name": "Application Development",
            "task_name": "Markdown Report Generator",
            "activity_type": "Development",
            "accomplishments": "• Implemented 1-click clipboard daily report formatting in markdown",
            "date": "2026-08-11",
            "start_time": "09:30",
            "duration": 150 # 2.5h
        },

        # Neha Sharma (QA & Business Logic Testing)
        {
            "user": "neha@ommnomi.in",
            "employee_name": "Neha Sharma",
            "project_name": "Application Development",
            "task_name": "Automated Offline Queue Validation",
            "activity_type": "Development",
            "accomplishments": "• Tested FIFO queue draining across intermittent network states\n• Verified savepoint rollbacks during simulated validation errors",
            "date": "2026-09-04",
            "start_time": "09:00",
            "duration": 240 # 4.0h
        },
        {
            "user": "neha@ommnomi.in",
            "employee_name": "Neha Sharma",
            "project_name": "General Operations",
            "task_name": "Cross-Browser Compatibility Testing",
            "activity_type": "Operations & Data",
            "accomplishments": "• Verified responsive layout on iOS Safari, Chrome Mobile, and Desktop Edge",
            "date": "2026-09-04",
            "start_time": "14:00",
            "duration": 90 # 1.5h
        },
        {
            "user": "neha@ommnomi.in",
            "employee_name": "Neha Sharma",
            "project_name": "Application Development",
            "task_name": "Idempotency & Duplicate Guard Tests",
            "activity_type": "Development",
            "accomplishments": "• Validated client_uuid deduplication logic on backend sync endpoint",
            "date": "2026-09-02",
            "start_time": "10:30",
            "duration": 180 # 3.0h
        },
        {
            "user": "neha@ommnomi.in",
            "employee_name": "Neha Sharma",
            "project_name": "General Operations",
            "task_name": "Accessibility (WCAG 2.1) Audit",
            "activity_type": "Operations & Data",
            "accomplishments": "• Audited focus rings, ARIA role attributes, and keyboard tab navigation",
            "date": "2026-08-20",
            "start_time": "11:00",
            "duration": 120 # 2.0h
        },
        {
            "user": "neha@ommnomi.in",
            "employee_name": "Neha Sharma",
            "project_name": "Application Development",
            "task_name": "End-to-End User Flow Benchmark",
            "activity_type": "Development",
            "accomplishments": "• Benchmarked session switching, voice note parsing, and finish flow latency",
            "date": "2026-08-05",
            "start_time": "14:00",
            "duration": 180 # 3.0h
        }
    ]

    inserted_count = 0
    for item in log_templates:
        # Calculate from_time and to_time datetimes
        date_str = item["date"]
        start_time_str = item["start_time"]
        duration_mins = item["duration"]
        total_hours = round(duration_mins / 60.0, 2)

        start_dt = datetime.strptime(f"{date_str} {start_time_str}:00", "%Y-%m-%d %H:%M:%S")
        end_dt = start_dt + timedelta(minutes=duration_mins)

        client_uuid = f"bootstrap_{item['user'][:6]}_{date_str}_{start_time_str.replace(':', '')}_{uuid.uuid4().hex[:6]}"

        # Check if identical record already exists
        existing = frappe.db.get_value(
            "Timesheet Log",
            {"user": item["user"], "from_time": start_dt.strftime("%Y-%m-%d %H:%M:%S")},
            "name"
        )

        if not existing:
            doc = frappe.get_doc({
                "doctype": "Timesheet Log",
                "project_name": item["project_name"],
                "task_name": item["task_name"],
                "activity_type": item["activity_type"],
                "employee_name": item["employee_name"],
                "user": item["user"],
                "status": "Completed",
                "is_billable": 1,
                "from_time": start_dt.strftime("%Y-%m-%d %H:%M:%S"),
                "to_time": end_dt.strftime("%Y-%m-%d %H:%M:%S"),
                "duration_minutes": duration_mins,
                "total_hours": total_hours,
                "accomplishments": item["accomplishments"],
                "client_uuid": client_uuid
            })
            doc.insert(ignore_permissions=True)
            inserted_count += 1
            print(f"  ✓ [{item['date']}] {item['employee_name']} ({total_hours}h) -> {item['project_name']}: {item['task_name']}")

    frappe.db.commit()
    print(f"\n🎉 Successfully seeded {inserted_count} historical Timesheet Log records across all 4 test users!")
    verify_summary()

def verify_summary():
    print("\n========================================================")
    print("📋 MULTI-TENANT TEST USER VERIFICATION REPORT")
    print("========================================================")
    users = [
        "hardiksharma80912@gmail.com",
        "nomeshwer@ommnomi.in",
        "meenaxi@ommnomi.in",
        "neha@ommnomi.in"
    ]

    for u in users:
        user_name = frappe.db.get_value("User", u, "full_name") or u
        total_logs = frappe.db.count("Timesheet Log", {"user": u})
        today_logs = frappe.db.sql("""
            SELECT SUM(total_hours) FROM `tabTimesheet Log`
            WHERE user = %s AND DATE(from_time) = '2026-09-04'
        """, (u,))[0][0] or 0.0

        month_logs = frappe.db.sql("""
            SELECT SUM(total_hours) FROM `tabTimesheet Log`
            WHERE user = %s AND YEAR(from_time) = 2026 AND MONTH(from_time) = 9
        """, (u,))[0][0] or 0.0

        aug_logs = frappe.db.sql("""
            SELECT SUM(total_hours) FROM `tabTimesheet Log`
            WHERE user = %s AND YEAR(from_time) = 2026 AND MONTH(from_time) = 8
        """, (u,))[0][0] or 0.0

        print(f"👤 {user_name} ({u})")
        print(f"   • Total Logs: {total_logs}")
        print(f"   • Today (2026-09-04): {float(today_logs):.1f} hrs")
        print(f"   • September 2026:     {float(month_logs):.1f} hrs")
        print(f"   • August 2026:        {float(aug_logs):.1f} hrs")
        print("--------------------------------------------------------")

if __name__ == "__main__":
    bootstrap()

