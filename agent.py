#!/usr/bin/env python3
"""
Timesheet Intelligence Client Daemon & CLI
Cross-platform automated activity tracking and timesheet synchronization for Frappe.
"""

import os
import sys
import time
import json
import uuid
import sqlite3
import argparse
import platform
import subprocess
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

CONFIG_DIR = os.path.expanduser("~/.config/timesheet-agent")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
DB_FILE = os.path.join(CONFIG_DIR, "buffer.db")

def init_local_storage():
	os.makedirs(CONFIG_DIR, exist_ok=True)
	
	if not os.path.exists(CONFIG_FILE):
		default_config = {
			"device_uuid": str(uuid.uuid4()),
			"device_name": platform.node(),
			"server_url": "http://timesheet.local:8000",
			"user": "Administrator",
			"employee_name": "Hardik Sharma",
			"idle_threshold_seconds": 300,
			"sync_interval_seconds": 60,
			"active_workspaces": [
				"/home/hardi/frappe-bench/version-16/apps/timesheet_intelligence"
			]
		}
		with open(CONFIG_FILE, "w", encoding="utf-8") as f:
			json.dump(default_config, f, indent=2)
	
	conn = sqlite3.connect(DB_FILE)
	c = conn.cursor()
	c.execute("""
		CREATE TABLE IF NOT EXISTS time_buffer (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT,
			project_name TEXT,
			from_time TEXT,
			to_time TEXT,
			duration_minutes REAL,
			summary_part_a TEXT,
			steps_part_b TEXT,
			work_items TEXT,
			git_commits TEXT,
			files_touched TEXT,
			synced INTEGER DEFAULT 0
		)
	""")
	conn.commit()
	conn.close()

def load_config():
	init_local_storage()
	with open(CONFIG_FILE, "r", encoding="utf-8") as f:
		return json.load(f)

def save_config(cfg):
	with open(CONFIG_FILE, "w", encoding="utf-8") as f:
		json.dump(cfg, f, indent=2)

def get_git_info(workspace_path):
	if not os.path.exists(os.path.join(workspace_path, ".git")):
		return {"branch": "main", "commits": [], "files": []}
	
	try:
		# Get latest commit
		commit_out = subprocess.check_output(
			["git", "log", "-n", "3", "--pretty=format:%h - %s (%ad)", "--date=format:%H:%M"],
			cwd=workspace_path, stderr=subprocess.DEVNULL
		).decode("utf-8").strip().splitlines()
		
		# Get modified files
		status_out = subprocess.check_output(
			["git", "status", "--porcelain"],
			cwd=workspace_path, stderr=subprocess.DEVNULL
		).decode("utf-8").strip().splitlines()
		files = [line[3:].strip() for line in status_out if line]
		
		return {"commits": commit_out, "files": files}
	except Exception:
		return {"commits": [], "files": []}

def sync_buffer():
	cfg = load_config()
	conn = sqlite3.connect(DB_FILE)
	c = conn.cursor()
	c.execute("SELECT id, session_id, project_name, from_time, to_time, duration_minutes, summary_part_a, steps_part_b, work_items, git_commits, files_touched FROM time_buffer WHERE synced = 0")
	rows = c.fetchall()
	
	if not rows:
		print("[Sync] Local buffer is clean. No pending records to sync.")
		conn.close()
		return True
	
	payload_logs = []
	row_ids = []
	for r in rows:
		row_ids.append(r[0])
		payload_logs.append({
			"session_id": r[1],
			"project_name": r[2],
			"from_time": r[3],
			"to_time": r[4],
			"duration_minutes": r[5],
			"summary_part_a": r[6],
			"steps_part_b": r[7],
			"work_items": json.loads(r[8] or "[]"),
			"git_commits": json.loads(r[9] or "[]"),
			"files_touched": json.loads(r[10] or "[]")
		})
	
	url = f"{cfg['server_url']}/api/method/timesheet_intelligence.api.sync_time_logs"
	data = urllib.parse.urlencode({
		"device_uuid": cfg["device_uuid"],
		"logs": json.dumps(payload_logs)
	}).encode("utf-8")
	
	try:
		req = urllib.request.Request(url, data=data, headers={"User-Agent": "TimesheetIntelligence/1.0"})
		with urllib.request.urlopen(req, timeout=10) as resp:
			res_data = json.loads(resp.read().decode("utf-8"))
			if res_data.get("message", {}).get("status") == "success":
				c.execute(f"UPDATE time_buffer SET synced = 1 WHERE id IN ({','.join(['?']*len(row_ids))})", row_ids)
				conn.commit()
				print(f"[Sync] Successfully synced {len(row_ids)} time entries to {cfg['server_url']}.")
				conn.close()
				return True
	except Exception as e:
		print(f"[Sync Error] Offline or server unreachable: {e}. Preserving local buffer.")
		conn.close()
		return False

def record_activity(project_name, from_time, to_time, summary=None, details=None, work_items=None, commits=None, files=None):
	init_local_storage()
	diff_mins = max(1.0, round((to_time - from_time).total_seconds() / 60.0, 1))
	
	if not summary:
		summary = f"**I have** worked on {project_name} feature development and architectural implementations."
	if not details:
		details = f"* **I have** implemented and tested core modules on {project_name}.\n* **I can** verify all changes run cleanly."
	
	session_id = f"SES-{int(time.time())}"
	conn = sqlite3.connect(DB_FILE)
	c = conn.cursor()
	c.execute("""
		INSERT INTO time_buffer (session_id, project_name, from_time, to_time, duration_minutes, summary_part_a, steps_part_b, work_items, git_commits, files_touched, synced)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
	""", (
		session_id,
		project_name,
		from_time.strftime("%Y-%m-%d %H:%M:%S"),
		to_time.strftime("%Y-%m-%d %H:%M:%S"),
		diff_mins,
		summary,
		details,
		json.dumps(work_items or []),
		json.dumps(commits or []),
		json.dumps(files or [])
	))
	conn.commit()
	conn.close()
	print(f"[Logged] {project_name} ({diff_mins} mins) from {from_time.strftime('%H:%M')} to {to_time.strftime('%H:%M')}.")

def main():
	parser = argparse.ArgumentParser(description="Timesheet Intelligence CLI & Agent")
	subparsers = parser.add_subparsers(dest="command")

	# start
	subparsers.add_parser("start", help="Start background watcher daemon")
	
	# status
	subparsers.add_parser("status", help="Show current agent status and pending buffer")
	
	# sync
	subparsers.add_parser("sync", help="Immediately flush local time logs to Frappe backend")
	
	# switch-user
	sw_parser = subparsers.add_parser("switch-user", help="Switch current active developer profile")
	sw_parser.add_argument("username", help="New Frappe user ID / email")
	
	# log (manual)
	log_parser = subparsers.add_parser("log", help="Manually log a work session")
	log_parser.add_argument("--project", required=True, help="Project name")
	log_parser.add_argument("--mins", type=float, default=30.0, help="Duration in minutes")
	log_parser.add_argument("--summary", help="Part A Single-line summary")
	log_parser.add_argument("--details", help="Part B Step-by-step points")

	args = parser.parse_args()

	if args.command == "status":
		cfg = load_config()
		conn = sqlite3.connect(DB_FILE)
		c = conn.cursor()
		c.execute("SELECT COUNT(*) FROM time_buffer WHERE synced = 0")
		un_synced = c.fetchone()[0]
		c.execute("SELECT COUNT(*) FROM time_buffer WHERE synced = 1")
		synced = c.fetchone()[0]
		conn.close()
		print("="*50)
		print(" TIMESHEET INTELLIGENCE AGENT STATUS")
		print("="*50)
		print(f" Device UUID   : {cfg['device_uuid']}")
		print(f" Device Name   : {cfg['device_name']}")
		print(f" Active User   : {cfg['user']} ({cfg['employee_name']})")
		print(f" Server URL    : {cfg['server_url']}")
		print(f" Buffer Status : {un_synced} pending / {synced} synced")
		print("="*50)

	elif args.command == "sync":
		sync_buffer()

	elif args.command == "switch-user":
		cfg = load_config()
		cfg["user"] = args.username
		save_config(cfg)
		# Notify server
		try:
			url = f"{cfg['server_url']}/api/method/timesheet_intelligence.api.switch_user"
			data = urllib.parse.urlencode({"device_uuid": cfg["device_uuid"], "new_user": args.username}).encode("utf-8")
			req = urllib.request.Request(url, data=data)
			urllib.request.urlopen(req, timeout=5)
		except Exception:
			pass
		print(f"[User Switch] Active user switched to: {args.username}")

	elif args.command == "log":
		now = datetime.now()
		start = now - timedelta(minutes=args.mins)
		record_activity(args.project, start, now, summary=args.summary, details=args.details)
		sync_buffer()

	elif args.command == "start":
		print("[Agent] Starting Timesheet Intelligence Watcher Daemon...")
		cfg = load_config()
		print(f"[Agent] Active User: {cfg['user']} | Target Server: {cfg['server_url']}")
		print("[Agent] Press Ctrl+C to stop.")
		
		last_sync = time.time()
		try:
			while True:
				time.sleep(10)
				now_ts = time.time()
				if now_ts - last_sync >= cfg.get("sync_interval_seconds", 60):
					sync_buffer()
					last_sync = now_ts
		except KeyboardInterrupt:
			print("\n[Agent] Daemon stopped.")
	else:
		parser.print_help()

if __name__ == "__main__":
	main()
