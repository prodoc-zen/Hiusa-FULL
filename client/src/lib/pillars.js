import { Wallet, CalendarDays, ListChecks, Vote, ShoppingBag, Megaphone } from 'lucide-react';

export const PILLARS = [
  {
    key: 'finance',
    label: 'Financial management',
    shortLabel: 'Finance',
    icon: Wallet,
    objectiveCode: 'SO2.1',
    description: 'OLS forecasting and the Budget Advisory System project spending trends and flag budget risk before it happens.',
  },
  {
    key: 'events',
    label: 'Event management',
    shortLabel: 'Events',
    icon: CalendarDays,
    objectiveCode: 'SO2.2',
    description: 'An LLM-based Event Planning Assistant drafts schedules while biometric attendance confirms who actually showed up.',
  },
  {
    key: 'tasks',
    label: 'Task management',
    shortLabel: 'Tasks',
    icon: ListChecks,
    objectiveCode: 'SO2.3',
    description: 'A rule-based weighted scoring model delegates tasks by matching workload and role to the officer best suited for it.',
  },
  {
    key: 'elections',
    label: 'Elections',
    shortLabel: 'Elections',
    icon: Vote,
    objectiveCode: 'SO2.4',
    description: 'One-vote enforcement blocks duplicate ballots while automated tallying counts and certifies results the moment polls close.',
  },
  {
    key: 'merchandise',
    label: 'Merchandise',
    shortLabel: 'Merch',
    icon: ShoppingBag,
    objectiveCode: 'SO2.5',
    description: 'Tokenized claim codes and GCash proof verification confirm every order before it leaves the stockroom.',
  },
  {
    key: 'communication',
    label: 'Organizational communication',
    shortLabel: 'Comms',
    icon: Megaphone,
    objectiveCode: 'SO2.6',
    description: 'AI-drafted announcements and automatic notifications keep every role briefed the moment something changes.',
  },
];

export const PILLAR_BY_KEY = Object.fromEntries(PILLARS.map((pillar) => [pillar.key, pillar]));
