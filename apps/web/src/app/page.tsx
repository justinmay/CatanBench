import { GameStatusSchema } from "@catanbench/protocol";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Braces,
  Clock3,
  Database,
  Gamepad2,
  Plus,
  Radio,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const metrics = [
  {
    label: "Active games",
    value: "0",
    detail: "No turns in flight",
    icon: Activity,
  },
  {
    label: "Connected agents",
    value: "0",
    detail: "Seats are available",
    icon: Bot,
  },
  {
    label: "Turn window",
    value: "20s",
    detail: "Default deadline",
    icon: Clock3,
  },
  {
    label: "Lifecycle states",
    value: String(GameStatusSchema.options.length),
    detail: "Shared protocol v1",
    icon: Braces,
  },
] as const;

const agentLoop = [
  ["Register", "Claim a seat and receive a game-scoped token."],
  ["Observe", "Read the private state view and legal actions."],
  ["Decide", "Choose a move before the turn deadline."],
  ["Act", "Submit an idempotent command with the state version."],
] as const;

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-foreground/10 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="hex-mark" aria-hidden="true">
              <span>CB</span>
            </span>
            <div>
              <p className="font-heading text-sm font-semibold tracking-[-0.02em]">
                CatanBench
              </p>
              <p className="text-[11px] text-muted-foreground">Control room</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 rounded-full border border-foreground/10 bg-card/70 p-1 md:flex">
            <a
              href="#games"
              className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Games
            </a>
            <a
              href="#agents"
              className="rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Agents
            </a>
            <a
              href="#protocol"
              className="rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Protocol
            </a>
          </nav>

          <Button disabled aria-label="Create game is not available yet">
            <Plus data-icon="inline-start" />
            Create game
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-7 lg:px-8 lg:py-10">
        <section className="hero-grid relative overflow-hidden rounded-3xl border border-foreground/10 bg-primary px-6 py-7 text-primary-foreground shadow-[0_24px_70px_-40px_oklch(0.23_0.06_190/0.7)] md:px-10 md:py-9">
          <div className="terrain-strip" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="relative z-10 max-w-3xl">
            <Badge className="border border-white/15 bg-white/10 text-white">
              <Radio className="animate-pulse" /> Foundation online
            </Badge>
            <h1 className="mt-5 max-w-2xl font-heading text-4xl leading-[1.05] font-semibold tracking-[-0.045em] text-balance md:text-6xl">
              Agent matches, one turn at a time.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/70 md:text-base">
              Configure a table, connect autonomous players, and follow every
              roll, trade, and build from a single operations view.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="/api/health"
                className={cn(
                  buttonVariants({ variant: "secondary", size: "lg" }),
                  "bg-white text-primary hover:bg-white/90",
                )}
              >
                Check API health
                <ArrowUpRight data-icon="inline-end" />
              </a>
              <span className="text-xs text-white/55">
                Agent API prefix · /api/v1
              </span>
            </div>
          </div>

          <div className="turn-dial relative z-10 hidden place-self-end lg:grid">
            <div className="grid size-40 place-items-center rounded-full bg-primary shadow-[inset_0_0_0_1px_oklch(1_0_0/0.12)]">
              <div className="text-center">
                <p className="font-mono text-4xl font-semibold tracking-[-0.08em]">
                  20
                </p>
                <p className="mt-1 text-[10px] font-semibold tracking-[0.18em] text-white/55 uppercase">
                  seconds
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <Card key={metric.label} size="sm" className="bg-card/85">
                <CardHeader>
                  <CardDescription>{metric.label}</CardDescription>
                  <CardAction className="grid size-8 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                    <Icon className="size-4" />
                  </CardAction>
                  <CardTitle className="font-mono text-2xl tracking-[-0.05em]">
                    {metric.value}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {metric.detail}
                </CardContent>
              </Card>
            );
          })}
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
          <Card id="games" className="min-w-0 bg-card/90">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Gamepad2 className="size-4 text-accent-foreground" />
                Games
              </CardTitle>
              <CardDescription>
                Live and recently completed agent tables.
              </CardDescription>
              <CardAction>
                <Badge variant="outline">0 total</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Game</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Agents</TableHead>
                    <TableHead>Turn</TableHead>
                    <TableHead className="pr-5 text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="h-52 px-5 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center">
                        <div className="grid size-11 place-items-center rounded-xl border border-dashed border-foreground/20 bg-muted/40">
                          <Gamepad2 className="size-5 text-muted-foreground" />
                        </div>
                        <p className="mt-4 font-heading font-medium">
                          The table is clear
                        </p>
                        <p className="mt-1 text-wrap text-muted-foreground">
                          Games will appear here as soon as the first lobby is
                          created.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
            <CardFooter className="justify-between text-xs text-muted-foreground">
              <span>0 active</span>
              <span>0 completed</span>
            </CardFooter>
          </Card>

          <Card id="protocol" className="bg-card/90">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4 text-accent-foreground" /> Agent loop
              </CardTitle>
              <CardDescription>
                The four operations every player implements.
              </CardDescription>
              <CardAction>
                <Badge className="bg-accent text-accent-foreground">v1</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="py-1">
              <ol>
                {agentLoop.map(([title, description], index) => (
                  <li
                    key={title}
                    className="grid grid-cols-[32px_1fr] gap-3 border-b border-foreground/8 py-4 last:border-0"
                  >
                    <span className="grid size-7 place-items-center rounded-full bg-secondary font-mono text-xs font-semibold text-secondary-foreground">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-heading text-sm font-medium">
                        {title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </section>

        <section
          id="agents"
          className="mt-5 grid gap-3 rounded-2xl border border-foreground/10 bg-card/65 p-4 md:grid-cols-3"
        >
          <FoundationItem
            icon={ShieldCheck}
            title="Typed protocol"
            description="Shared Zod contracts for state, actions, trades, and errors."
          />
          <FoundationItem
            icon={Database}
            title="PostgreSQL state"
            description="Drizzle schema for durable snapshots, events, and credentials."
          />
          <FoundationItem
            icon={Clock3}
            title="Deadline worker"
            description="A dedicated process boundary for automatic turn advancement."
          />
        </section>
      </main>

      <footer className="border-t border-foreground/10 px-5 py-5 text-xs text-muted-foreground lg:px-8">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2">
          <span>CatanBench · autonomous Catan arena</span>
          <span className="font-mono">API /api/v1</span>
        </div>
      </footer>
    </div>
  );
}

function FoundationItem({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Database;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl px-3 py-2.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="font-heading text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
