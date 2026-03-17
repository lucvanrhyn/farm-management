# FarmTrack Launch Website And Product Plan

Date: 2026-03-17

## 1. Clarifying The Automation Gap

This gap is not "the idea is wrong." It is simply that the product story already describes an automation layer more fully than the current app implements in code.

### What the documentation says

The project docs describe:

- n8n workflows
- daily summaries
- intelligent alerts
- weekly management reports
- grazing rotation recommendations
- breeding reports
- weather/rainfall integrations
- a webhook flow from the app into automations

Relevant docs:

- `PROJECT.md`
- `farm-management/PROJECT.md`

### What the current app actually does

The current app does already handle:

- logging observations
- offline sync
- camp and animal data views
- admin review and edits

But the automation layer is still mostly outside the product or not yet wired up:

- `app/api/webhook/route.ts` currently returns `501 Not implemented`
- there are no in-repo n8n workflow definitions
- there is no visible in-app alert center tied to a true rules engine
- there is no scheduled summary/reporting pipeline implemented in the app layer
- the docs still talk heavily about Google Sheets + n8n, while the current app is running through Prisma/Turso-style storage

### Plain-English meaning

For demos, this is not fatal.

It just means you should present automation honestly as:

- partially planned
- partially architecture-ready
- selectively available in custom rollout

Not as "fully productized and live for every customer" unless you wire it up first.

## 2. Why Competitors Actually Win Market Share

This is the most important finding from the deeper research:

The leaders do not win only because they have more features.

They win because they reduce buying risk.

They make it easy for a farmer to believe:

- "I can start quickly"
- "someone will help me"
- "this already works for farms like mine"
- "I know what I get for the money"
- "my team can actually use this in the field"

## 3. The Seven Market-Share Drivers

### 1. They make setup feel easy

This is huge.

Examples:

- Herdwatch says their team can upload the full herd for the customer.
- Mobble says it includes data import, map file upload, and free setup service.
- Ranchr includes import from outside sources.
- CattleMax has support, videos, classes, and structured getting-started help.

What this means for FarmTrack:

- your setup fee is not a weakness
- it is part of the value proposition
- the website should actively sell setup, customization, and onboarding

### 2. They offer low-friction entry

Examples:

- Herdwatch has a free digital calving book and a starter offer.
- Ranchr has a free plan plus a premium trial.
- CattleMax offers a 21-day free trial with support.
- Farmbrite offers a 14-day free trial with no credit card.
- AgriWebb offers free trials and interactive demos.

What this means for FarmTrack:

- your CTA should not be "contact us to maybe talk"
- it should be one of:
  - book a tailored demo
  - send us your spreadsheet
  - get a custom walkthrough

### 3. They all sell support and customer success, not just software

Examples:

- AgriWebb has local support, training services, a help center, and AgriWebb Academy.
- Farmbrite pushes 100% human support and customer success.
- CattleMax uses "ranchers helping ranchers" as support positioning.
- Mobble includes one-on-one training and direct support.
- Herdwatch highlights in-app chat, phone support, and help with herd uploads.

What this means for FarmTrack:

- your partnership model is commercially strong
- you should lean into it much harder
- this is one of the best things to "steal"

### 4. They are field-first and offline-first

Examples:

- AgriWebb: offline entry, map-based drag-and-drop mob movements, tasks
- Herdwatch: offline, pictures, EID readers, pasture mapping
- Ranchr: fully offline capable, images, cattle history
- Mobble: online/offline on any device, geolocated tasks, mapping
- Farmbrite: offline scouting, task management, field mapping

What this means for FarmTrack:

- keep the field logger dead simple
- make the map and field workflows visibly central in the product and on the website

### 5. They turn records into action

Examples:

- task management
- reminders
- reports
- bulk actions
- treatment tracking
- compliance records
- alerts

This is where FarmTrack still has room to grow.

Logging data is good.
Directing attention is better.

### 6. They show proof everywhere

Examples:

- AgriWebb says it is trusted by over 17,000 producers and used by over 25% of Australia’s grazing animals.
- Herdwatch says it is used on over 20,000 farms and ranches and claims members save 3 hours per week on paperwork on average.
- Mobble says it serves 3,000+ ranchers, 2,200+ ranches, and 21M acres under management.
- Farmbrite says 5,000+ farmers trust it worldwide and highlights a 4.9 customer satisfaction rating.
- CattleMax says ranchers in 70+ countries have trusted it since 1999.
- Ranchr has a 4.6/5 rating from 633 ratings on the US App Store.

What this means for FarmTrack:

- you need proof fast
- until you have customer case studies, use:
  - a strong founder story
  - a real demo farm
  - screenshots
  - demo video
  - implementation process
  - pilot testimonials as soon as possible

### 7. They package their offer clearly

The best competitors are easy to understand:

- what the product is
- who it is for
- what the plan includes
- how support works
- how to start

What this means for FarmTrack:

- the website must explain setup fee + monthly partnership clearly
- do not hide the model
- make it feel premium, tailored, and farm-specific

## 4. What FarmTrack Should Steal Immediately

These are the best near-term ideas to copy and adapt.

### From AgriWebb

- task management connected to farm map and movements
- GPS-aware notes and field actions
- stronger "operations center" language
- interactive demo framing

### From Herdwatch

- free/entry-level wedge offer
- customer support doing herd uploads
- picture records
- pasture as a standalone value story

### From Mobble

- setup service as a selling point
- map file imports as part of onboarding
- geolocated tasks
- "simple to get started" messaging

### From CattleMax

- deeper cattle-specific analytics
- scheduled task/calendar structure
- better support/training visibility
- best-practice demo calls tied to the customer's operation

### From Ranchr

- simple, modern UX
- image-rich animal records
- very clear pricing ladder
- easier spreadsheet import language

### From Farmbrite

- stronger website structure
- bigger trust layer
- broader operational storytelling
- dashboards, analytics, and support packaged clearly

## 5. Positioning Recommendation For FarmTrack

Do not position FarmTrack as generic farm software.

That category is too wide and too noisy.

Position it as:

> A customized cattle-and-camp operating system for farms that want a live management view, simpler field logging, and ongoing support.

That gives you room to sell:

- setup fee
- dashboard customization
- monthly support
- continuous iteration

## 6. Business Model Story To Put On The Website

This is the message to lean into:

### FarmTrack is not only software

We:

- import your current records
- map your farm
- configure your dashboard for your operation
- train your team
- support and improve it with you every month

That is a better offer than "sign up and figure it out yourself."

## 7. Website Structure Recommendation

Priority: this should be the launch skeleton.

### Page 1: Home

Purpose:

- explain what FarmTrack is
- show the product
- show the partnership/setup model
- drive demo inquiries

Recommended sections:

1. Hero
2. Problem / Why farms switch
3. What FarmTrack does
4. How the partnership works
5. Custom dashboard section
6. Core modules
7. Who it is for
8. Why FarmTrack over spreadsheets / generic apps
9. Pricing model overview
10. FAQ
11. Final CTA

### Page 2: Product

Purpose:

- show modules in more detail

Recommended sections:

- Field Logger
- Farm Map
- Animal Records
- Alerts & Follow-ups
- Reporting
- Finance
- Dashboard Customization

### Page 3: Setup & Customization

Purpose:

- sell the setup fee
- make onboarding feel easy

Recommended sections:

- send us your spreadsheet
- map and camp setup
- dashboard customization
- team onboarding
- ongoing support

### Page 4: Pricing

Purpose:

- explain setup + monthly subscription cleanly

Recommended structure:

- one-time setup
- monthly subscription
- optional premium customization / advisory tier

### Page 5: Demo / Contact

Purpose:

- get leads quickly

Recommended sections:

- short form
- what happens after you submit
- turnaround expectations
- what to send us

## 8. Homepage Draft Copy Outline

This is not polished final copy.
It is the launch skeleton.

## Hero

Headline option 1:

Farm management built around your farm.

Headline option 2:

A live operating system for cattle farms.

Headline option 3:

Replace spreadsheets and guesswork with one live farm view.

Subheading:

FarmTrack gives cattle farms a simple field logger, a live camp-and-herd dashboard, and a setup process tailored to your operation. We import your records, customize your dashboard, and support your team every month.

Primary CTA:

Book a tailored demo

Secondary CTA:

Send us your spreadsheet

Supporting trust strip:

- Customized to your farm
- Works in the field
- Built for ongoing monthly support

## Problem Section

Headline:

Most farms are still managing with spreadsheets, notebooks, and memory.

Supporting copy:

That means missed follow-ups, poor visibility, duplicated record keeping, and too much time spent trying to understand what is happening across the farm. FarmTrack brings your camps, animals, field activity, and management view into one place.

## Outcome Section

Headline:

Know what needs attention without chasing information.

Bullets:

- See camp status at a glance
- Track animals, movements, treatments, and calving records
- Record field activity from the phone
- Give management a live dashboard instead of scattered updates

## Partnership Section

Headline:

We do the setup with you, not just sell you software.

Supporting copy:

Every farm is different. That is why FarmTrack is delivered as a partnership. We set up your map, import your current records, configure your dashboard around your operation, and support your team as you use it.

Mini steps:

1. We review your current setup
2. We import your spreadsheet and farm data
3. We customize your dashboard
4. We train your team
5. We support and improve it monthly

## Custom Dashboard Section

Headline:

Your dashboard should reflect your farm, not a generic template.

Supporting copy:

Some farms care most about grazing rotation. Others care about breeding, health, finance, or worker accountability. FarmTrack can be configured around the parts of the operation that matter most to you.

Example dashboard modules:

- Daily inspection status
- Open alerts and overdue follow-ups
- Herd overview
- Camp and grazing condition
- Water and fence issues
- Breeding and calving activity
- Treatments and withdrawal dates
- Movement history
- Rainfall and weather
- Financial snapshot

## Product Modules Section

Headline:

Everything your team needs to log, see, and act.

Cards:

- Field Logger
  - Fast mobile logging for daily camp checks, movements, health issues, calving, and conditions.
- Live Farm Map
  - A visual overview of camps, grazing pressure, water issues, and inspections.
- Animal Records
  - Movement, health, treatment, and breeding history in one place.
- Alerts & Follow-Ups
  - Spot what needs attention before it becomes expensive.
- Admin & Reporting
  - Clean records, imports, edits, and management reports.

## Who It Is For

Headline:

Built for cattle farms that manage by camps and need clear oversight.

Supporting bullets:

- owner-managed cattle farms
- farms with one or more field workers
- operations moving off Excel
- farms that want a customized dashboard and ongoing support

## Why FarmTrack

Headline:

Why farms choose FarmTrack

Bullets:

- personalized setup
- dashboard customization
- ongoing monthly support
- simple field workflows
- visual management view
- built around real farm operations, not generic admin software

## Pricing Section

Headline:

Simple commercial model. Tailored to your farm.

Supporting copy:

FarmTrack is typically delivered with:

- a one-time setup fee for onboarding, customization, data import, and map configuration
- a monthly subscription for platform access, support, and ongoing improvements

CTA:

Get a tailored quote

## FAQ

Suggested questions:

- Can you import our current spreadsheet?
- Do you customize the dashboard for each farm?
- Can multiple people use FarmTrack?
- Does it work on phone and desktop?
- Can we manage camps, grazing, and animal records?
- Do you help with setup and training?
- What does the monthly subscription include?

## Final CTA

Headline:

Want to see what FarmTrack could look like on your farm?

Supporting copy:

Book a tailored demo or send us your current spreadsheet and we’ll show you how FarmTrack can be configured for your operation.

Buttons:

- Book a demo
- Send us your spreadsheet

## 9. Dashboard Recommendation: What A Farm Dashboard Needs Beyond The Current Version

Your current dashboard already has the right backbone:

- map
- camp drill-down
- animal drill-down
- status colors

What it needs now is more executive clarity and more visual polish.

## 10. High-Value Dashboard Modules To Add

### Must-have launch modules

#### 1. Morning Briefing / Today Board

At the very top:

- camps not yet inspected
- critical alerts
- health follow-ups due
- animals moved today
- births / deaths / treatments in last 24 hours

This should answer:

"What needs attention today?"

#### 2. Open Alerts Panel

Examples:

- water low
- fence damaged
- camp overdue for inspection
- health issue logged but not followed up
- withdrawal period ending

#### 3. Recent Activity Feed

Examples:

- Dicky inspected Camp B at 08:10
- Cow BX-042 moved from A to D
- Health issue recorded in Uithoek

#### 4. Camp Pressure Summary

Examples:

- overgrazed camps
- camps due for rest
- animal count versus hectares
- water/fence status summary

#### 5. Herd Health Snapshot

Examples:

- open health cases
- treatments this week
- cows due to calve
- recent mortalities

#### 6. Team Accountability

Examples:

- inspections completed by user
- outstanding tasks
- daily coverage

### Strong next-step modules

- rainfall and weather overlay
- breeding performance panel
- cost-to-health linkages
- treatment cost per animal/camp
- camp history timeline
- export-ready management summary

## 11. Map UI Recommendations

This is one of the most important product polish opportunities.

Right now the map works, but it still feels more like an internal tool than a premium command center.

### Design direction

The map should feel like:

- a farm operations cockpit
- clean enough for an owner
- detailed enough for a manager
- fast enough for daily use

### What to improve

#### 1. Add a stronger command bar

Top area should feel more premium and useful:

- farm selector
- date range
- active alerts count
- inspections due
- quick filters
- "share summary" or "export"

#### 2. Move from plain map to layered operations view

Use overlays:

- alert pins
- water points
- fence issue markers
- recent movement markers
- weather/rainfall layer

#### 3. Improve filter controls

Current filters are useful, but visually basic.

Upgrade them into clear filter chips:

- grazing
- water
- inspection age
- density
- health
- activity

#### 4. Richer camp cards

When a camp is clicked, show:

- name
- animal count
- condition
- inspection age
- water/fence status
- open issues
- recent events
- small trend chart
- optional photo

#### 5. Better mobile behavior

On mobile:

- use bottom sheets
- keep the map visible
- make actions thumb-friendly
- let users swipe between camp and animal context

#### 6. Stronger visual identity

Use:

- deeper earth palette
- stronger contrast
- better typography hierarchy
- more deliberate spacing
- subtle motion for alert pulses and drill-down transitions

### Good inspiration patterns

- Wandering Shepherd: map-first alerts and action-ready dashboard language
- fieldmargin: practical farm mapping, features, and team planning
- Mobble: easy setup messaging and mapping workflows

## 12. Product Plan: What To Build Before Sending More Demos

This plan assumes speed matters more than building everything.

### Phase 1: Demo-ready commercial polish

- build the public website skeleton
- tighten the FarmTrack message around setup + customization + monthly support
- prepare one outstanding demo farm dataset
- polish map UI and dashboard header
- add a visible "today board" / alert strip
- make the product screenshots and short demo video

### Phase 2: Most valuable workflow upgrades

- add tasks and reminders
- add photo attachments to observations
- add follow-up workflow after health issues
- add simple alert center
- add spreadsheet onboarding and setup flow copy to the site

### Phase 3: Stronger management intelligence

- add weather/rainfall module
- add breeding and calving summary
- add better trend reporting
- add management export/share summaries

### Phase 4: Full automation layer

- implement webhook triggers
- build the actual alert pipeline
- build scheduled summaries
- wire custom customer automations as premium service

## 13. Recommended Commercial Packaging

This is the model your website should imply, even if you do not publish exact prices yet.

### Setup Fee

Includes:

- spreadsheet import
- map setup
- animal and camp configuration
- dashboard personalization
- onboarding/training

### Monthly Subscription

Includes:

- platform access
- support
- updates
- ongoing improvements
- data backup / reporting support

### Premium / Managed Tier

Includes:

- custom reports
- advanced automations
- extra dashboard modules
- higher-touch support

## 14. Recommended Message To Repeat Everywhere

Use some version of this often:

> FarmTrack helps cattle farms replace spreadsheets and scattered updates with a live, customized operating dashboard. We handle setup, map your camps, import your records, train your team, and support you monthly.

That message is much closer to how you actually want to sell this.

## 15. Sources

Official sources used:

- [AgriWebb homepage](https://www.agriwebb.com)
- [AgriWebb pricing](https://www.agriwebb.com/pricing/)
- [AgriWebb contact and support](https://www.agriwebb.com/contact/)
- [AgriWebb free trial](https://www.agriwebb.com/us/try-for-free/)
- [AgriWebb App Store listing](https://apps.apple.com/us/app/agriwebb/id1176363153)
- [Herdwatch homepage](https://herdwatch.com/)
- [Herdwatch pricing](https://herdwatch.com/price/)
- [Herdwatch cattle solution](https://herdwatch.com/cattle/)
- [Herdwatch pasture solution](https://herdwatch.com/solutions/pasture/)
- [Herdwatch contact and onboarding FAQ](https://herdwatch.com/contact-us/)
- [Herdwatch App Store listing](https://apps.apple.com/us/app/herdwatch-livestock-management/id1487855852)
- [Mobble US homepage](https://www.mobble.io/us)
- [Mobble US pricing](https://www.mobble.io/us/pricing)
- [Mobble small producer page](https://www.mobble.io/us/small-producer-pricing)
- [CattleMax pricing](https://www.cattlemax.com/pricing)
- [CattleMax support](https://www.cattlemax.com/support)
- [CattleMax demo](https://www.cattlemax.com/demo)
- [CattleMax contact](https://www.cattlemax.com/contact)
- [CattleMax team](https://www.cattlemax.com/meet-the-team)
- [Ranchr homepage](https://ranchr.com/)
- [Ranchr pricing](https://ranchr.com/pricing/)
- [Ranchr features](https://ranchr.com/features/)
- [Ranchr FAQ](https://ranchr.com/support/faq/)
- [Ranchr App Store listing](https://apps.apple.com/us/app/ranchr-cattle-record-keeping/id1249777511)
- [Farmbrite homepage](https://www.farmbrite.com/)
- [Farmbrite pricing](https://www.farmbrite.com/pricing)
- [Farmbrite customer success](https://www.farmbrite.com/customer-success)
- [Farmbrite contact](https://www.farmbrite.com/contact-us)
- [Farmbrite App Store listing](https://apps.apple.com/us/app/farmbrite/id1482587341)
- [fieldmargin mapping](https://www.fieldmargin.com/mapping)
- [fieldmargin work planning](https://www.fieldmargin.com/plan-work)
- [Wandering Shepherd](https://www.wanderingshepherd.com/)

Internal references used:

- `PROJECT.md`
- `farm-management/PROJECT.md`
- `farm-management/app/api/webhook/route.ts`
- `farm-management/components/dashboard/DashboardClient.tsx`
- `farm-management/components/dashboard/SchematicMap.tsx`
- `farm-management/components/map/FarmMap.tsx`
- `farm-management/components/ui/FarmSelectPage.tsx`
- `farm-management/components/ui/animated-hero.tsx`
