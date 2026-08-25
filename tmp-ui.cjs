const fs = require('fs');
const must = (f, s, b, a) => { if (!s.includes(b)) throw new Error(`missing in ${f}: ${b.slice(0,60)}`); return s.replace(b, a); };

// --- page: date picker + honest wording ------------------------------------
{
  const f = 'app/(app)/attendance/monitor/page.tsx';
  let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

  s = must(f, s, `        <h1 className="text-page-title text-slate-900">Agent Monitoring</h1>`,
`        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-page-title text-slate-900">Agent Monitoring</h1>
          {/* The same board, any day. Yesterday is the question people actually
              ask of it — "what did the floor do" — and it was answerable only
              by having been watching at the time. */}
          <MonitorDatePicker date={viewDate} today={today} />
        </div>`);

  s = must(f, s, `          {isTeamLead ? "Your agents" : "All agents"} for {today}.{" "}`,
`          {isTeamLead ? "Your agents" : "All agents"} for {viewDate}
          {isToday ? "" : " — a finished day, so nothing is counting up"}.{" "}`);

  s = must(f, s, `            <span className="font-medium">Standby today</span> is the shift&apos;s total so far. Totals across a date
          range are in the Activity Report.`,
`            <span className="font-medium">Standby today</span> is the shift&apos;s total. Totals across a date
          range are in the Activity Report.`);

  s = must(f, s, '      <AgentMonitorBoard rows={rows} generatedAt={generatedAt} attendanceSource={attendanceSource} />',
    '      <AgentMonitorBoard rows={rows} generatedAt={generatedAt} attendanceSource={attendanceSource} live={isToday} />');

  s = must(f, s, 'import { fetchPortalAttendance, portalOwnsAttendance } from "@/lib/portal-attendance";',
    'import { fetchPortalAttendance, portalOwnsAttendance } from "@/lib/portal-attendance";\nimport { MonitorDatePicker } from "@/components/MonitorDatePicker";');

  fs.writeFileSync(f, s);
}

// --- board: stop the clocks on a finished day ------------------------------
{
  const f = 'components/AgentMonitorBoard.tsx';
  let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

  s = must(f, s, `  attendanceSource = "roma",
}: {
  rows: MonitorRow[];
  generatedAt: string;
  attendanceSource?: AttendanceSource;
}) {`,
`  attendanceSource = "roma",
  live = true,
}: {
  rows: MonitorRow[];
  generatedAt: string;
  attendanceSource?: AttendanceSource;
  /**
   * Whether this is today.
   *
   * A finished day has nothing to poll and nothing to count up, and doing
   * either would be worse than useless: the pulse fingerprints TODAY's floor,
   * so on a historical board it would fire on every call an agent makes now and
   * re-render a page about last Tuesday.
   */
  live?: boolean;
}) {`);

  // the two intervals and the pulse all stand down
  s = must(f, s, `  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);`,
`  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);`);

  s = must(f, s, `  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);`,
`  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router, live]);`);

  s = must(f, s, '  const lastPulse = useRef<string | null>(null);\n  useEffect(() => {\n    let cancelled = false;',
    '  const lastPulse = useRef<string | null>(null);\n  useEffect(() => {\n    if (!live) return;\n    let cancelled = false;');
  s = must(f, s, `      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);`,
`      document.removeEventListener("visibilitychange", check);
    };
  }, [router, live]);`);

  fs.writeFileSync(f, s);
}
console.log('ui wired');
