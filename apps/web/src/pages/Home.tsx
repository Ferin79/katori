import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, toDateStr } from '@katori/shared';
import { api } from '../api';
import { InstallHint } from '../components/Install';
import { Banner, Card, ErrorNote, Loading, SectionHead } from '../components/ui';
import { dayMonth, dayShort, fullDate, kcal } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';
import {
  BodyCompCard,
  EnergyCard,
  Last7Card,
  MacroTiles,
  ProteinCard,
  SlotsCard,
  StreakCard,
  TodayCard,
  TodayMealsCard,
  TopCard,
  WaistCard,
  WeightCard,
} from './home/cards';

function SuggestionCard({ pid, message, current, suggested }: { pid: string; message: string; current: number; suggested: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const decide = useMutation({
    mutationFn: (action: 'accepted' | 'dismissed') => api.decideSuggestion(pid, action),
    onSuccess: (_, action) => {
      toast(action === 'accepted' ? `Target updated to ${kcal(suggested)} kcal` : 'OK, keeping your target');
      void qc.invalidateQueries();
    },
  });
  return (
    <Card title="A better target?" testId="card-suggestion">
      <p>{message}</p>
      <p className="small muted" style={{ marginTop: 6 }}>
        {kcal(current)} → {kcal(suggested)} kcal. Suggestions come at most once a week.
      </p>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => decide.mutate('accepted')} disabled={decide.isPending} data-testid="suggestion-accept">
          Use {kcal(suggested)} kcal
        </button>
        <button className="btn" onClick={() => decide.mutate('dismissed')} disabled={decide.isPending} data-testid="suggestion-dismiss">
          Not now
        </button>
      </div>
    </Card>
  );
}
function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** The last seven days; tap one to see that day. A dot marks days with something logged. */
function DayStrip({ today, selected, logged, onPick }: { today: string; selected: string; logged: Set<string>; onPick: (date: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <div className="days" role="group" aria-label="Day to show" data-testid="day-strip">
      {days.map((day) => (
        <button key={day} type="button" aria-pressed={day === selected} aria-label={day === today ? `Today, ${fullDate(day)}` : fullDate(day)} onClick={() => onPick(day)} data-testid={`day-${day}`}>
          {dayShort(day)}
          <span className="d">{Number(day.slice(8))}</span>
          <span className={`dot${logged.has(day) ? ' on' : ''}`} />
        </button>
      ))}
    </div>
  );
}

export function Home() {
  const pid = usePid();
  const { current } = useProfiles();
  const [params, setParams] = useSearchParams();
  const today = toDateStr(new Date());
  const asked = params.get('day');
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked < today ? asked : today;
  const isToday = day === today;
  const live = useQuery({
    queryKey: ['dashboard', pid],
    queryFn: () => api.dashboard(pid),
    // Keep pending estimates moving on screen.
    refetchInterval: (q) => (q.state.data?.today.pending ? 2500 : 60_000),
  });
  const past = useQuery({ queryKey: ['dashboard', pid, day], queryFn: () => api.dashboard(pid, day), enabled: !isToday });
  const { data: d, error, isLoading } = isToday ? live : past;
  const logged = new Set((live.data?.streak.heatmap ?? []).filter((c) => c.state !== 'none').map((c) => c.date));
  const pick = (date: string) => setParams(date === today ? {} : { day: date }, { replace: true });

  return (
    <>
      <div className="greet">
        <div className="hello">{greeting()}</div>
        <div className="who">
          <h1 data-testid="home-title">{current?.name}</h1>
          {(d ?? live.data)?.minor && <span className="badge badge-accent">Intake tracking</span>}
        </div>
      </div>
      <DayStrip today={today} selected={day} logged={logged} onPick={pick} />
      <InstallHint />
      {isLoading ? (
        <Loading />
      ) : error || !d ? (
        <ErrorNote error={error} />
      ) : (
        <>
          {d.today.toReview > 0 && (
            <Banner tone="info" testId="review-banner" title={`${d.today.toReview} meal${d.today.toReview > 1 ? 's' : ''} to review`}>
              <p>Check the estimate, fix anything off, and confirm.</p>
            </Banner>
          )}
          {d.today.failed > 0 && (
            <Banner tone="error" testId="failed-banner" title={`${d.today.failed} estimate${d.today.failed > 1 ? 's' : ''} failed`}>
              <p>Open the meal to retry or enter it by hand.</p>
            </Banner>
          )}
          <TodayCard d={d} isToday={isToday} />
          <MacroTiles d={d} />
          {isToday && d.suggestion && <SuggestionCard pid={pid} message={d.suggestion.message} current={d.suggestion.currentKcal} suggested={d.suggestion.suggestedKcal} />}
          <TodayMealsCard pid={pid} d={d} isToday={isToday} />

          <SectionHead title={isToday ? 'This week' : `Week to ${dayMonth(d.date)}`} />
          <div className="group">
            <Last7Card d={d} />
            <EnergyCard d={d} />
            <ProteinCard d={d} />
          </div>

          <SectionHead title="Weight and body" />
          <div className="group">
            <WeightCard d={d} />
            <BodyCompCard d={d} />
            <WaistCard d={d} />
          </div>

          <SectionHead title="Habits" />
          <div className="group">
            <StreakCard d={d} />
            <SlotsCard d={d} />
            <TopCard d={d} />
          </div>

          <Link to="/progress" className="btn btn-outline btn-block" data-testid="home-to-progress">
            See Month and Journey
          </Link>
        </>
      )}
    </>
  );
}
