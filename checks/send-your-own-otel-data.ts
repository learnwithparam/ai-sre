// send-your-own-otel-data: otel-export.json is one OTLP export from a small service. The check reads
// the shape a backend needs: a named service, a version, real span names, ids, and no email.
import type { Rule } from "../scripts/verify";
import { EMAIL, read } from "./lib/files";

type Attribute = { key: string; value: { stringValue?: string } };
type Span = { traceId: string; spanId: string; parentSpanId?: string; name: string; attributes?: Attribute[] };
type Export = {
  resourceSpans?: { resource?: { attributes?: Attribute[] }; scopeSpans?: { spans?: Span[] }[] }[];
};

function exported(folder: string): Export {
  try {
    return JSON.parse(read(folder, "otel-export.json")) as Export;
  } catch {
    return {};
  }
}

const resource = (folder: string, key: string): string =>
  exported(folder)
    .resourceSpans?.flatMap((group) => group.resource?.attributes ?? [])
    .find((attribute) => attribute.key === key)?.value.stringValue ?? "";

const spans = (folder: string): Span[] =>
  (exported(folder).resourceSpans ?? []).flatMap((group) =>
    (group.scopeSpans ?? []).flatMap((scope) => scope.spans ?? []),
  );

export default [
  {
    says: "the export has at least two spans",
    test: (folder) => spans(folder).length >= 2,
    tryNext: "paste the export from your service into otel-export.json; it needs two spans or more",
  },
  {
    says: "service.name is set and is not unknown_service",
    test: (folder) => {
      const name = resource(folder, "service.name");
      return name.length > 0 && !name.startsWith("unknown_service");
    },
    tryNext: "set the OTEL_SERVICE_NAME variable, so the backend can group your spans by service",
  },
  {
    says: "service.version is set",
    test: (folder) => resource(folder, "service.version").length > 0,
    tryNext: "add service.version to the resource attributes, so an error can be tied to a release",
  },
  {
    says: "every span has a 32 character trace id and a 16 character span id",
    test: (folder) =>
      spans(folder).length > 0 &&
      spans(folder).every((span) => /^[0-9a-f]{32}$/.test(span.traceId) && /^[0-9a-f]{16}$/.test(span.spanId)),
    tryNext: "copy the ids from the real export; do not type your own",
  },
  {
    says: "every span name says what happened, not only GET or POST",
    test: (folder) =>
      spans(folder).length > 0 && spans(folder).every((span) => !/^(GET|POST|PUT|DELETE)$/.test(span.name)),
    tryNext: "name a span after the route or the work, such as GET /checkin",
  },
  {
    says: "at least one span has a parent in the same trace",
    test: (folder) => {
      const all = spans(folder);
      return all.some((span) => span.parentSpanId && all.some((other) => other.spanId === span.parentSpanId));
    },
    tryNext: "send one request that makes a second call, so a child span points at its parent",
  },
  {
    says: "no span attribute holds an email address",
    test: (folder) =>
      spans(folder).length > 0 &&
      spans(folder).every((span) => (span.attributes ?? []).every((a) => !EMAIL.test(a.value.stringValue ?? ""))),
    tryNext: "remove or hash any attribute that holds an email before the data leaves your service",
  },
] satisfies Rule[];
