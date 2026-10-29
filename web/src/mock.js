// Sample nodes and notes added the first time an account is opened.
// Every item has `mock: true`, so "Remove sample notes" can find them later.
import { MIN, HOUR, DAY } from './util.js';

export function mockData(now = Date.now()) {
  const hubs = [
    { id: 'mock-trilops', name: 'Trilops', color: '#5ee6c9' },
    { id: 'mock-periegesis', name: 'Periegesis', color: '#ffb547' },
    { id: 'mock-personal', name: 'Personal', color: '#a78bfa' },
  ].map((hub, i) => ({ ...hub, createdAt: now - (30 - i) * DAY, updatedAt: now - (30 - i) * DAY, mock: true }));

  let age = 0;
  const note = (id, hubId, project, title, body, tags = [], expiresAt = null) => {
    age += 5 * HOUR;
    return {
      id: `mock-${id}`, hubId: `mock-${hubId}`, project, title, body, tags, expiresAt,
      createdAt: now - age - DAY, updatedAt: now - age,
      trashedAt: null, trashReason: null, history: [], device: 'Sample', mock: true,
    };
  };

  const notes = [
    note('kickoff', 'trilops', 'Website revamp', 'Kickoff call',
      '- Goal: new site live before the end of the quarter\n- They want the pricing page simplified\n- Next call Thursday: bring two homepage options', ['meeting']),
    note('copy', 'trilops', 'Website revamp', 'Homepage copy ideas',
      'Lead with outcomes, not features.\nTry: "Plan less, ship more."\nAsk them for three customer quotes.', ['ideas']),
    note('launch', 'trilops', 'Website revamp', 'Launch checklist',
      '- Redirects from the old URLs\n- Analytics on the new pages\n- Test the contact form\n- Announcement post', ['todo'], now + 5 * DAY),
    note('numbers', 'trilops', 'Q4 report', 'Numbers to pull',
      'Revenue by region, churn, top 10 accounts. Due to their finance lead by the 15th.', ['finance', 'todo']),
    note('questions', 'trilops', 'Q4 report', 'Open questions',
      'Do they want last year side by side? Which currency?', []),
    note('office', 'trilops', '', 'Office visit',
      'Reception is on the 3rd floor. Parking behind the building.', ['info']),

    note('sprint', 'periegesis', 'Mobile app', 'Sprint 12 goals',
      'Offline mode for trips\nFaster map loading\nFix the login loop on Android', ['sprint']),
    note('bugs', 'periegesis', 'Mobile app', 'Bug triage',
      'Crash when a trip has no dates: high\nWrong currency symbol on receipts: medium\nTypos in onboarding: low', ['bugs']),
    note('design', 'periegesis', 'Mobile app', 'Design feedback',
      'Make the itinerary cards larger. Dark mode contrast is too low on the map.', ['design']),
    note('interview', 'periegesis', 'Hiring', 'Backend interview questions',
      '1. Walk me through a system you designed.\n2. How do you handle a slow query in production?\n3. What would you change in your last codebase?', ['hiring'], now + 2 * DAY),
    note('candidates', 'periegesis', 'Hiring', 'Candidates',
      'Shortlist due Friday. Two strong, one maybe.', ['hiring']),
    note('boom', 'periegesis', '', 'This note self-destructs',
      'Its expiry is set to two minutes after the sample notes were added. Watch it burst in the graph, then find it in Trash.', ['demo'], now + 2 * MIN),

    note('ideas', 'personal', 'Ideas', 'kang-notes ideas',
      'Pin favourite notes\nColour tags\nVoice notes on the phone', ['ideas']),
    note('groceries', 'personal', 'Errands', 'Groceries',
      'Eggs, coffee, tomatoes, bread', ['todo'], now + 3 * HOUR),
    note('books', 'personal', 'Reading', 'Books to read',
      'Thinking in Systems\nThe Mom Test\nShape Up', ['books']),
  ];

  return { hubs, notes };
}
