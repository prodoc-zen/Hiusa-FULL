// The name a person reads for the engine that wrote a draft. EngineBadge shows any name it does not know as given.
const NAMES = { claude: 'Claude', groq: 'Groq', template: 'Built-in rules' };

export function engineName(engine) {
  return NAMES[engine] || engine || null;
}
