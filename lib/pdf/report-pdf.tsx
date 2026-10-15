import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { label } from "@/lib/constants";
import { fmtDate, fmtMoney } from "@/lib/dates";
import type { ReportData, ReportDeliverable } from "@/lib/report";

const C = { ink: "#14171a", mute: "#5b6670", line: "#d9dee3", accent: "#d98d22", ok: "#1f8a5b", warn: "#b4541a" };
const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontFamily: "Helvetica", fontSize: 9.5, color: C.ink, lineHeight: 1.4 },
  brand: { fontSize: 9, color: C.accent, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: "Helvetica-Bold" },
  h1: { fontSize: 22, lineHeight: 1.25, fontFamily: "Helvetica-Bold", marginTop: 8 },
  sub: { color: C.mute, marginTop: 6 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 20, marginBottom: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: C.line },
  stats: { flexDirection: "row", gap: 10, marginTop: 18 },
  stat: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 8 },
  statN: { fontSize: 18, lineHeight: 1.2, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  statL: { fontSize: 8, lineHeight: 1.2, color: C.mute, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: C.line },
  head: { flexDirection: "row", paddingVertical: 3, backgroundColor: "#f2f4f6" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: C.mute, textTransform: "uppercase" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 160 },
  img: { width: 160, height: 110, objectFit: "cover", borderRadius: 3, backgroundColor: "#eef0f2" },
  cap: { fontSize: 8, color: C.mute, marginTop: 2 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: C.mute },
});

function Table({ items, cols }: { items: ReportDeliverable[]; cols: "done" | "open" }) {
  return (
    <View>
      <View style={s.head}>
        <Text style={[s.th, { flex: 5, paddingLeft: 4 }]}>Deliverable</Text>
        <Text style={[s.th, { flex: 1.6 }]}>Category</Text>
        <Text style={[s.th, { flex: 1.4 }]}>{cols === "done" ? "Completed" : "Due"}</Text>
        {cols === "open" && <Text style={[s.th, { flex: 1.6 }]}>Status</Text>}
      </View>
      {items.map((d) => (
        <View key={d.id} style={s.row} wrap={false}>
          <View style={{ flex: 5, paddingLeft: 4, paddingRight: 6 }}>
            <Text>{d.description}</Text>
            {d.event && <Text style={{ fontSize: 8, color: C.mute }}>{d.event}</Text>}
          </View>
          <Text style={{ flex: 1.6 }}>{label(d.category)}</Text>
          <Text style={{ flex: 1.4 }}>{cols === "done" ? fmtDate(d.completed_on) : fmtDate(d.due_date)}</Text>
          {cols === "open" && <Text style={{ flex: 1.6, color: C.warn }}>{label(d.status)}</Text>}
        </View>
      ))}
    </View>
  );
}

export type PdfImage = { data: Buffer; format: "png" | "jpg" };

export function ReportPdf({ r, images }: { r: ReportData; images: Record<string, PdfImage> }) {
  const pctDone = r.completionRate == null ? "—" : `${Math.round(r.completionRate * 100)}%`;
  const photos = r.evidence.filter((e) => images[e.asset_id]);
  const docs = r.evidence.filter((e) => !images[e.asset_id]);
  return (
    <Document title={`${r.sponsor.name} — Partnership Recap`} author={r.organization} subject="Sponsor recap report">
      <Page size="LETTER" style={s.page}>
        <Text style={s.brand}>{r.organization} · Partnership recap</Text>
        <Text style={s.h1}>{r.sponsor.name}</Text>
        <Text style={s.sub}>
          {fmtDate(r.range.from)} – {fmtDate(r.range.to)} · {label(r.sponsor.tier)} partner{r.sponsor.industry ? ` · ${r.sponsor.industry}` : ""}
        </Text>

        <View style={s.stats}>
          <View style={s.stat}><Text style={s.statN}>{r.contracted.length}</Text><Text style={s.statL}>Contracted</Text></View>
          <View style={s.stat}><Text style={[s.statN, { color: C.ok }]}>{r.completed.length}</Text><Text style={s.statL}>Delivered</Text></View>
          <View style={s.stat}><Text style={s.statN}>{r.outstanding.length}</Text><Text style={s.statL}>Outstanding</Text></View>
          <View style={s.stat}><Text style={s.statN}>{pctDone}</Text><Text style={s.statL}>Fulfillment</Text></View>
        </View>

        {r.highlights && (<><Text style={s.h2}>Campaign highlights</Text><Text>{r.highlights}</Text></>)}

        <Text style={s.h2}>Agreement</Text>
        {r.contracts.length === 0 ? <Text style={s.sub}>No active contract overlaps this period.</Text> : r.contracts.map((c, i) => (
          <View key={i} style={s.row}>
            <Text style={{ flex: 4 }}>{c.name}</Text>
            <Text style={{ flex: 3 }}>{fmtDate(c.start_date)} – {fmtDate(c.end_date)}</Text>
            <Text style={{ flex: 1.5 }}>{label(c.status)}</Text>
            <Text style={{ flex: 1.5, textAlign: "right" }}>{fmtMoney(c.value)}</Text>
          </View>
        ))}

        <Text style={s.h2}>Contracted deliverables ({r.contracted.length})</Text>
        {r.contracted.length === 0 ? <Text style={s.sub}>No deliverables fall in this period.</Text> : (
          <View>
            <View style={s.head}><Text style={[s.th, { flex: 5, paddingLeft: 4 }]}>Deliverable</Text><Text style={[s.th, { flex: 1.6 }]}>Category</Text><Text style={[s.th, { flex: 1.4 }]}>Due</Text><Text style={[s.th, { flex: 1.6 }]}>Status</Text></View>
            {r.contracted.map((d) => (
              <View key={d.id} style={s.row} wrap={false}>
                <Text style={{ flex: 5, paddingLeft: 4, paddingRight: 6 }}>{d.description}</Text>
                <Text style={{ flex: 1.6 }}>{label(d.category)}</Text>
                <Text style={{ flex: 1.4 }}>{fmtDate(d.due_date)}</Text>
                <Text style={{ flex: 1.6, color: d.status === "completed" ? C.ok : C.ink }}>{label(d.status)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.h2}>Completed deliverables ({r.completed.length})</Text>
        {r.completed.length ? <Table items={r.completed} cols="done" /> : <Text style={s.sub}>None completed in this period.</Text>}

        <Text style={s.h2}>Outstanding deliverables ({r.outstanding.length})</Text>
        {r.outstanding.length ? <Table items={r.outstanding} cols="open" /> : <Text style={s.sub}>Everything contracted for this period has been delivered.</Text>}

        <Text style={s.h2}>Performance metrics</Text>
        {r.metrics.length === 0 ? <Text style={s.sub}>No metrics were recorded for this period.</Text> : r.metrics.map((m, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={{ flex: 5 }}>{m.name}</Text>
            <Text style={{ flex: 2, textAlign: "right", fontFamily: "Helvetica-Bold" }}>{m.value.toLocaleString("en-US")}{m.unit ? ` ${m.unit}` : ""}</Text>
            <Text style={{ flex: 2, textAlign: "right", color: C.mute }}>{fmtDate(m.date)}</Text>
          </View>
        ))}

        <Text style={s.h2} break={photos.length > 3}>Evidence of fulfillment ({r.evidence.length})</Text>
        {r.evidence.length === 0 && <Text style={s.sub}>No evidence has been shared for this period.</Text>}
        <View style={s.photos}>
          {photos.map((e) => (
            <View key={e.id} style={s.photo} wrap={false}>
              <Image src={images[e.asset_id]} style={s.img} />
              <Text style={s.cap}>{e.caption || e.deliverable || e.filename}{e.event ? ` · ${e.event}` : ""} · {fmtDate(e.date)}</Text>
            </View>
          ))}
        </View>
        {docs.length > 0 && <View style={{ marginTop: 8 }}>{docs.map((e) => <Text key={e.id} style={s.cap}>• {e.caption || e.filename} ({fmtDate(e.date)})</Text>)}</View>}

        <View style={s.footer} fixed>
          <Text>{r.organization} · {r.sponsor.name} · generated {fmtDate(r.generatedAt)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
