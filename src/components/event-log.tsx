import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface EventRow {
  id: number;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export function EventLog({ events }: { events: EventRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Event log</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ScrollArea className="h-64 pr-4">
            <ul className="space-y-2 text-sm">
              {events.map((event) => (
                <li key={event.id} className="rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{event.type}</span>
                    <time className="text-xs text-muted-foreground">
                      {event.createdAt.toLocaleTimeString()}
                    </time>
                  </div>
                  {event.payload != null && (
                    <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
