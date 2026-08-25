const fs = require('fs');
const must = (f, s, b, a) => { if (!s.includes(b)) throw new Error(`missing in ${f}: ${b.slice(0,60)}`); return s.replace(b, a); };

// 1. Changing the day clears the state filter.
{
  const f = 'components/MonitorDatePicker.tsx';
  let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  s = must(f, s, `    const params = new URLSearchParams(searchParams.toString());
    if (next === today) params.delete("date");
    else params.set("date", next);`,
`    const params = new URLSearchParams(searchParams.toString());
    if (next === today) params.delete("date");
    else params.set("date", next);
    /**
     * The state filter does not travel with the date.
     *
     * Carrying it seemed tidier and was wrong: the states worth filtering on
     * today — On call, Standby, Between calls — barely exist on a finished day,
     * where everyone has timed out. Paging back to yesterday with Standby still
     * set produced an empty table under a full set of tiles, which reads as
     * "yesterday has no data" rather than "the filter excludes all of it".
     */
    params.delete("state");`);
  s = must(f, s, ` * The date rides in the URL rather than in state so it survives the board's own
 * refresh, can be sent to somebody, and steps through with the back button. The
 * state filter is carried along, so paging from one day to the next does not
 * silently drop it.`,
` * The date rides in the URL rather than in state so it survives the board's own
 * refresh, can be sent to somebody, and steps through with the back button.`);
  fs.writeFileSync(f, s);
}

// 2. A finished day is not "right now".
{
  const f = 'components/AgentMonitorBoard.tsx';
  let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  s = must(f, s, '                  {filter ? `Nobody is ${STATE_META[filter].label.toLowerCase()} right now.` : "No agents to monitor."}',
`                  {filter
                    ? live
                      ? `Nobody is ${STATE_META[filter].label.toLowerCase()} right now.`
                      : `Nobody was ${STATE_META[filter].label.toLowerCase()} on this day.`
                    : "No agents to monitor."}`);
  fs.writeFileSync(f, s);
}
console.log('filter no longer follows the date');
