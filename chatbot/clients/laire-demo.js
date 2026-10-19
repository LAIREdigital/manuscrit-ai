// Pilot client: LAIRE DEMO HubSpot portal. Copy this file to add a client, then register it in index.js.
import crawl from "./laire-demo.crawl.js";

// Hand-written facts and FAQ. Sent with every question, so keep it short.
const always = `
# Services overview
LAIRE serves B2B companies across industries. Services: marketing strategy and planning, website design and development (HubSpot CMS), SEO and AEO, paid media, content marketing, email and marketing automation, HubSpot onboarding, integrations and training.

# Booking a call
Visitors can book a free marketing assessment call with the LAIRE team. The chat window shows the booking link.

# Pricing
Pricing depends on scope. The team covers it on a short call after learning about the business and goals.
`;

export default {
  config: {
    botName: "LAIRE Assistant",
    company: "LAIRE Digital",
    about: "LAIRE is a B2B digital marketing agency and HubSpot partner: strategy, websites, SEO and AEO, paid media, content, and HubSpot onboarding and automation.",
    tone: "warm, confident, plain English, no hype",
    greeting: "Hi, I'm the LAIRE assistant. Ask me about our services, HubSpot, or how we work.",
    suggestions: ["What services do you offer?", "Do you build HubSpot websites?", "Can I book a call?"],
    theme: { primary: "#0b2545", accent: "#f2a541", text: "#ffffff", logo: "" },
    // TODO(Sam): confirm the meetings link the bot should open (HubSpot meetings page or talk-to-todd).
    meetingUrl: "https://www.lairedigital.com/talk-to-todd",
    privacyUrl: "https://www.lairedigital.com/terms-conditions",
    leadAfter: 2,
    pricing: "never",
    hubspot: {
      portalId: "242678301",
      // TODO(Sam): GUID of a form in the LAIRE DEMO portal with email, firstname, lastname, company, message.
      formGuid: "",
      fields: { transcript: "message" },
    },
    // Sites allowed to call the Worker. TODO(Sam): add the LAIRE DEMO portal's site domain.
    origins: ["https://www.lairedigital.com", "https://lairedigital.github.io", "http://localhost:8080"],
  },
  always,
  knowledge: crawl,
};
