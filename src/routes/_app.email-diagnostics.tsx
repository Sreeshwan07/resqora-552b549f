import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MailCheck } from "lucide-react";
import { PageHeader } from "@/components/system/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { emailProviderStatus } from "@/lib/emergency-email.functions";

export const Route = createFileRoute("/_app/email-diagnostics")({
  head: () => ({
    meta: [
      { title: "Email diagnostics — RESQORA" },
      {
        name: "description",
        content: "Status of RESQORA's server-side emergency email delivery.",
      },
      { property: "og:title", content: "RESQORA email diagnostics" },
      {
        property: "og:description",
        content: "Whether emergency emails to contacts and Guardians can currently be sent.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmailDiagnosticsPage,
});

function EmailDiagnosticsPage() {
  const status = useServerFn(emailProviderStatus);
  const { data, isLoading } = useQuery({
    queryKey: ["email-provider-status"],
    queryFn: () => status(),
  });
  const configured = data?.configured ?? false;
  return (
    <>
      <PageHeader
        icon={MailCheck}
        title="Email diagnostics"
        description="Emergency emails are sent only by the RESQORA server, to the contacts saved in your account."
      />
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Server email delivery</CardTitle>
          <Badge variant={configured ? "default" : "destructive"}>
            {isLoading ? "Checking…" : configured ? "Connected" : "Not configured"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {configured ? (
            <p>Emergency emails are sent by the server and every attempt is recorded.</p>
          ) : (
            <p>
              No email sender is connected yet. Emergency email alerts are recorded as "failed — not
              configured"; SMS, push and in-app alerts keep working.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
