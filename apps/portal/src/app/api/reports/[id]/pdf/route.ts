// On-demand PDF generation for the reports page.
// Regenerates the PDF from the stored rawQboData + narrative so we don't
// need to persist binary files in the database.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@vericount/db";
import { buildReportPDF } from "@vericount/pdf";

// We import the PDF builder directly — the reporting service exposes it as a
// standalone export so both the service and this route can use it.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Find the report and verify it belongs to the signed-in client
  const client = await prisma.client.findUnique({ where: { clerkUserId: userId } });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report || report.clientId !== client.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!report.rawQboData || !report.narrative) {
    return NextResponse.json(
      { error: "Report data not available yet" },
      { status: 404 }
    );
  }

  const financialData = report.rawQboData as Parameters<typeof buildReportPDF>[0]["financialData"];

  const periodLabel = formatPeriodLabel(report.period);
  const pdfBytes = await buildReportPDF({
    clientId: client.id,
    clientName: client.name,
    businessName: client.businessName,
    period: periodLabel,
    financialData,
    narrative: report.narrative,
  });

  const filename = `vericount-report-${report.period}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBytes.byteLength.toString(),
      "Cache-Control": "private, max-age=300",
    },
  });
}

function formatPeriodLabel(period: string): string {
  // "2025-01" → "January 2025"
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
  }
  return period;
}
