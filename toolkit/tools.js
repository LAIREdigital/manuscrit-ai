// The tool list on the toolkit homepage. Add or edit a tool here, nothing else to change.
//
// status: "live" (url opens it), "slack" (lives in Slack, url optional),
//         "soon" (not built yet). A live or slack tool with no url shows "Link coming".
// owner:  who built it or looks after it.
// photo:  team headshot in img/team/ (Sea Glass duotone, from the LAIRE design system).
//         Leave empty to show the LAIRE A mark.

export const TOOLS = [
  {
    name: "Manuscrit.AI",
    owner: "LAIRE team",
    status: "live",
    url: "manuscrit/",
    blurb: "The second brain for authors. Capture ideas by voice, text or screenshot and file them into the right book and chapter.",
    tags: ["Writing", "AI"],
  },
  {
    name: "ICP Qualifier",
    owner: "LAIRE team",
    status: "live",
    url: "https://lairedigital.github.io/laire-agents/docs/",
    blurb: "Check a new lead against a client ideal customer profile and get a verdict ready to paste in Slack.",
    tags: ["Sales", "HubSpot"],
  },
  {
    name: "LAIRE Workspace",
    owner: "LAIRE team",
    status: "live",
    url: "",
    blurb: "Tasks, clients and time in one shared workspace, built on Google Sheets.",
    tags: ["Operations"],
  },
  {
    name: "Content Scoring Tool",
    owner: "Paola",
    photo: "paola",
    status: "live",
    url: "",
    blurb: "Score a piece of content on seven quality checks, flag dealbreakers and get a scorecard.",
    tags: ["Content"],
  },
  {
    name: "AI Readiness Self Check",
    owner: "Maarten",
    photo: "maarten",
    status: "live",
    url: "",
    blurb: "A quick self check that shows how ready a business is to put AI to work.",
    tags: ["AI", "Assessment"],
  },
  {
    name: "Agents",
    owner: "Chris",
    photo: "chris",
    status: "live",
    url: "",
    blurb: "Agents that take repeat work off the team.",
    tags: ["Agents"],
  },
  {
    name: "Slack Agents",
    owner: "Sylvie",
    photo: "sylvie",
    status: "slack",
    url: "",
    blurb: "Agents that answer and act inside Slack.",
    tags: ["Agents", "Slack"],
  },
  {
    name: "Slack Agents",
    owner: "Karla",
    photo: "karla",
    status: "slack",
    url: "",
    blurb: "Agents that answer and act inside Slack.",
    tags: ["Agents", "Slack"],
  },
  {
    name: "Slack Agents",
    owner: "Kelsey",
    photo: "kelsey",
    status: "slack",
    url: "",
    blurb: "Agents that answer and act inside Slack.",
    tags: ["Agents", "Slack"],
  },
  {
    name: "Next tool",
    owner: "",
    status: "soon",
    url: "",
    blurb: "Have an idea for a tool? Tell Sam and it goes here.",
    tags: [],
  },
];
