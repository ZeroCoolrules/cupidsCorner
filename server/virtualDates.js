// Virtual dates — ported from the Bid-Love date simulator.
//
// A matched user picks a scripted date scenario and makes one choice per
// step. Each choice nudges a chemistry score; a few "treat" choices cost
// sparks (that is how this feature earns). The result is posted into the
// pair's DM so the other person sees it and has something to talk about.
//
// Deliberately NOT ported from Bid-Love: bidding tokens on people, "hookup"
// tiers, and cashing tokens out. Paying people for dates with redeemable
// tokens creates serious legal exposure; sparks here stay closed-loop.

export const DATE_SCENARIOS = [
  {
    key: "rooftop",
    title: "Rooftop lounge",
    emoji: "🌃",
    blurb: "City lights, a cozy booth, and a conversation that goes deep.",
    steps: [
      {
        id: "arrive",
        title: "First impression",
        text: "You spot your date waiting near the entrance. They look even better than their photos.",
        choices: [
          { id: "smile", text: "Greet them with a warm smile and a compliment", impact: 10 },
          { id: "wave", text: "Play it cool with a casual wave", impact: 5 },
          { id: "phone", text: "Finish checking your phone first", impact: -5 },
        ],
      },
      {
        id: "settle",
        title: "Getting settled",
        text: "You find a booth by the window. What do you open with?",
        choices: [
          { id: "ask", text: "Ask about what they love doing", impact: 10 },
          { id: "brag", text: "Talk about your own wins this week", impact: 0 },
          { id: "drinks", text: "Treat them to signature mocktails (20 ✨)", impact: 12, cost: 20 },
        ],
      },
      {
        id: "deep",
        title: "Deep conversation",
        text: "Your date opens up about a dream they have never told anyone.",
        choices: [
          { id: "listen", text: "Listen closely and share one of yours", impact: 15 },
          { id: "advise", text: "Offer advice on how to make it happen", impact: 5 },
          { id: "change", text: "Steer to something lighter", impact: -5 },
        ],
      },
      {
        id: "moment",
        title: "The moment",
        text: "A comfortable silence. Your eyes meet.",
        choices: [
          { id: "hold", text: "Hold their gaze and smile", impact: 15 },
          { id: "joke", text: "Break the tension with a joke", impact: 5 },
          { id: "away", text: "Look away nervously", impact: -10 },
        ],
      },
      {
        id: "goodbye",
        title: "End of the night",
        text: "You step outside into the cool evening air.",
        choices: [
          { id: "enjoyed", text: "Tell them how much you enjoyed tonight", impact: 10 },
          { id: "dessert", text: "Suggest dessert down the street (30 ✨)", impact: 12, cost: 30 },
          { id: "bye", text: "Thank them and say goodbye", impact: 0 },
        ],
      },
    ],
  },
  {
    key: "arcade",
    title: "Neon arcade",
    emoji: "🕹️",
    blurb: "Air hockey, claw machines, and a little friendly trash talk.",
    steps: [
      {
        id: "pick",
        title: "First game",
        text: "The arcade is buzzing. Which machine first?",
        choices: [
          { id: "hockey", text: "Air hockey, winner picks the next game", impact: 10 },
          { id: "solo", text: "Your favorite solo game while they watch", impact: -5 },
          { id: "tokens", text: "Load up a big cup of tokens for both of you (20 ✨)", impact: 12, cost: 20 },
        ],
      },
      {
        id: "lose",
        title: "Sore loser?",
        text: "They beat you. Badly.",
        choices: [
          { id: "rematch", text: "Laugh and demand a rematch", impact: 15 },
          { id: "excuse", text: "Blame the table", impact: -5 },
          { id: "concede", text: "Admit they are the champion", impact: 10 },
        ],
      },
      {
        id: "claw",
        title: "The claw machine",
        text: "They eye a plush heart in the claw machine.",
        choices: [
          { id: "win", text: "Keep trying until you win it for them (25 ✨)", impact: 15, cost: 25 },
          { id: "cheer", text: "Cheer them on while they try", impact: 10 },
          { id: "skip", text: "Say claw machines are rigged", impact: 0 },
        ],
      },
      {
        id: "snack",
        title: "Snack break",
        text: "You grab a seat at the snack bar.",
        choices: [
          { id: "share", text: "Split a giant pretzel", impact: 10 },
          { id: "stories", text: "Swap embarrassing childhood stories", impact: 15 },
          { id: "scroll", text: "Show them memes on your phone", impact: 0 },
        ],
      },
      {
        id: "photo",
        title: "Photo booth",
        text: "There is a photo booth by the exit.",
        choices: [
          { id: "silly", text: "Four silly faces in a row", impact: 15 },
          { id: "pass", text: "Skip it, you hate photos", impact: -5 },
          { id: "frame", text: "Get the strip framed as a keepsake (15 ✨)", impact: 12, cost: 15 },
        ],
      },
    ],
  },
];

export const SCENARIO_BY_KEY = Object.fromEntries(DATE_SCENARIOS.map((s) => [s.key, s]));

const START_SCORE = 50;

// Validates one choice id per step and returns the outcome, or throws with a
// user-facing message.
export function scoreDate(scenarioKey, choiceIds) {
  const scenario = SCENARIO_BY_KEY[scenarioKey];
  if (!scenario) throw new Error("unknown date scenario");
  if (!Array.isArray(choiceIds) || choiceIds.length !== scenario.steps.length) {
    throw new Error("pick one choice for every step");
  }
  let score = START_SCORE;
  let cost = 0;
  const picked = scenario.steps.map((step, i) => {
    const choice = step.choices.find((c) => c.id === choiceIds[i]);
    if (!choice) throw new Error(`invalid choice for "${step.title}"`);
    score += choice.impact;
    cost += choice.cost || 0;
    return { step: step.title, choice: choice.text };
  });
  score = Math.max(0, Math.min(100, score));
  return { scenario, score, cost, picked };
}

export function verdictFor(score) {
  if (score >= 85) return "Sparks flew";
  if (score >= 65) return "Great chemistry";
  if (score >= 45) return "A promising start";
  return "Awkward, but memorable";
}
