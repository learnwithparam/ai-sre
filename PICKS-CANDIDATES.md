# Watch and read candidates

For the page pass to cut to 4 to 6 per part, with at least 2 videos. Each passes the bar in STANDARD-v2 section 5: made by the person or team that made or runs the method, about the idea and not a launch, never a listicle. Links are not yet checked live.

## Orientation and part 01: See every signal

- Charity Majors, Observability 2.0 talks, 2023 onward (video): she co-wrote the book on observability and runs Honeycomb. Idea, not product.
- OpenTelemetry project, "What is OpenTelemetry?" docs, kept current (read): the project's own docs.
- OpenTelemetry project, semantic conventions for resources and service.name (read): the standard itself.
- Google SRE Book, "Monitoring Distributed Systems", 2016 (read): written by the team that runs it.
- Ben Sigelman, "Distributed tracing: a practical history" talks, 2018 (video): co-creator of Dapper-style tracing at Lightstep.
- Google, "Dapper, a Large-Scale Distributed Systems Tracing Infrastructure", 2010 (paper): the original paper.
- Cindy Sridharan, "Distributed Systems Observability", 2018 (read, O'Reilly report): practitioner who ran it in production.
- OpenTelemetry project, collector docs, "Architecture" (read): the project's own docs.

## Part 02: Know when it is broken

- Google SRE Workbook, "Alerting on SLOs", 2018 (read): the team that runs it.
- Google SRE Book, "Service Level Objectives", 2016 (read): the original chapter.
- Alex Hidalgo, "Implementing Service Level Objectives" talks, 2020 (video): former Google SRE who wrote the book.
- Liz Fong-Jones, "SLOs and burn rate alerts" talks, 2019 (video): worked on SRE at Google, now Honeycomb.
- Rob Ewaschuk, "My Philosophy on Alerting", 2013 (read): written while he was a Google SRE.
- Prometheus project docs, "Alerting best practices" (read): the project's own docs.
- Datadog engineering blog, "Alert fatigue" posts (read): runs it in production; pick the idea post, not a product post.
- Brendan Gregg, "The USE Method", 2012 onward (read): the inventor of the method.

## Part 03: Look without touching

- Anthropic, "Model Context Protocol" introduction and spec (read): made by the protocol's authors.
- Anthropic engineering blog, "Building effective agents", 2024 (read): the team that makes it.
- Model Context Protocol, tool annotations such as readOnlyHint, spec section (read): the spec itself.
- Simon Willison, "The lethal trifecta for AI agents", 2025 (read): well known security researcher who named it.
- Brendan Gregg, "Linux Performance Analysis in 60 seconds", Netflix tech blog, 2015 (read): written by the person who runs it.
- Charity Majors, "Testing in production" talks, 2019 (video): practitioner at Honeycomb.
- ClickHouse docs, "Observability with ClickHouse" guide (read): the vendor of the database writing about the idea.
- HyperDX/ClickStack docs, "Search and patterns" (read): the project's own docs.

## Part 04: Say what broke

- Google SRE Workbook, "Incident Response", 2018 (read): written by the team that runs it.
- Google SRE Book, "Effective Troubleshooting", 2016 (read): the team that runs it.
- Anthropic, "Citations" guide and "Reduce hallucinations" docs (read): the model maker's own docs.
- Hamel Husain, "Your AI product needs evals", 2024 (read): practitioner who ships LLM systems.
- PagerDuty, "Incident Response" documentation, open source (read): the company that runs on-call at scale.
- Atlassian, "Incident management handbook" (read): the company's own handbook.
- Dave Zwieback, "Beyond Blame" talks on debugging with evidence, 2015 (video): author on the topic.
- Fred Hebert, "Operable Software" or "Learning from Incidents" talks, 2019 (video): practitioner in production.

## Part 05: Ask before you act

- Anthropic, "Claude Code permissions and hooks" docs (read): the maker's docs.
- Anthropic engineering blog, "Writing tools for agents", 2025 (read): the team that makes it.
- Google SRE Book, "Automation at Google: the evolution", 2016 (read): the team that runs it.
- Lisanne Bainbridge, "Ironies of Automation", 1983 (paper): the original paper.
- Hillel Wayne or Fred Hebert talks on human in the loop operations, 2020 (video): practitioner.
- AWS Builders' Library, "Avoiding fallback in distributed systems", 2019 (read): the team that runs it.
- Netflix tech blog, "Safe deploys with canary analysis" (read): the team that runs it.
- Sidney Dekker, "Just Culture" talks, 2012 (video): the author of the idea.

## Part 06: Write it down

- Google SRE Book, "Postmortem Culture: Learning from Failure", 2016 (read): the team that runs it.
- Etsy engineering blog, "Blameless PostMortems and a Just Culture", John Allspaw, 2012 (read): the author of the method.
- John Allspaw, "Incident analysis" talks at Velocity or SREcon, 2017 (video): the originator of the practice.
- Dan Luu, "Post-mortems" list on GitHub (read): public list of real write-ups.
- PagerDuty, "Incident Response" open docs on roles: commander, scribe, comms (read): the company that runs it.
- Atlassian, "Incident management handbook", roles and updates (read): the company's own handbook.
- Jeli, "Howie: the post-incident guide", 2021 (read): written by incident analysis practitioners.
- Cloudflare blog, a published postmortem such as the 2019 regex outage (read): shows a real timeline.

## Part 07: Prove the AI SRE right

- Hamel Husain, "Your AI product needs evals", 2024 (read): practitioner who ships LLM systems.
- Anthropic, "Define success criteria and build evaluations" docs (read): the model maker's docs.
- Eugene Yan, "Patterns for building LLM-based systems", 2023 (read): practitioner write-up.
- Shreya Shankar et al., "Who validates the validators?", 2024 (paper): the original paper on judging judges.
- Lianmin Zheng et al., "Judging LLM-as-a-Judge with MT-Bench", 2023 (paper): the original paper.
- Simon Willison, "Prompt injection explained", 2023 (video or read): the person who named it.
- OpenTelemetry project, "Semantic conventions for generative AI" (read): the standard itself.
- Charity Majors, "Observability for LLM apps" talks, 2024 (video): practitioner.

## Part 08: Trace model calls with ClickStack

- OpenTelemetry project, "GenAI semantic conventions" (read): the standard itself.
- ClickHouse blog, "ClickStack: the open source observability stack" (read): the makers' own introduction; check it is about the idea.
- ClickHouse docs, "Observability with ClickHouse" (read): the makers' own docs.
- Honeycomb blog, "Observability for LLM applications", 2023 (read): the team that runs it in production.
- Anthropic docs, "Usage and token counting" (read): the model maker.
- Charity Majors talks on high cardinality data, 2019 (video): practitioner.
- Google, "Dapper" paper, 2010 (paper): the original idea for traces.
- Brendan Gregg, "Flame graphs", 2016 (video): inventor of the method.
