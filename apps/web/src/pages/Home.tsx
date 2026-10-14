import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Banner, Card, ErrorNote, Loading } from '../components/ui';
import { kcal } from '../lib/format';
import { useToast } from '../lib/useToast';
import { usePid, useProfiles } from '../profile';
import {
  BodyCompCard,
  EnergyCard,
  Last7Card,
  MacrosCard,
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

export function Home() {
  const pid = usePid();
  const { current } = useProfiles();
  const { data: d, error, isLoading } = useQuery({
    queryKey: ['dashboard', pid],
    queryFn: () => api.dashboard(pid),
    // Keep pending estimates moving on screen.
    refetchInterval: (q) => (q.state.data?.today.pending ? 2500 : 60_000),
  });
  if (isLoading) return <Loading />;
  if (error || !d) return <ErrorNote error={error} />;

  return (
    <>
      <div className="page-head">
        <h1 data-testid="home-title">{current?.name}</h1>
        {d.minor && <span className="badge">Intake tracking</span>}
      </div>
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
      {d.suggestion && <SuggestionCard pid={pid} message={d.suggestion.message} current={d.suggestion.currentKcal} suggested={d.suggestion.suggestedKcal} />}
      <TodayCard d={d} />
      <MacrosCard d={d} />
      <TodayMealsCard pid={pid} d={d} />
      <Last7Card d={d} />
      <WeightCard d={d} />
      <EnergyCard d={d} />
      <BodyCompCard d={d} />
      <WaistCard d={d} />
      <ProteinCard d={d} />
      <StreakCard d={d} />
      <SlotsCard d={d} />
      <TopCard d={d} />
      <p className="small muted" style={{ textAlign: 'center' }}>
        Month and Journey views are under <Link to="/progress">Progress</Link>.
      </p>
    </>
  );
}
