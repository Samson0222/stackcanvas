import { SignUp } from "@clerk/nextjs";
import { Cpu, Share2, FileText } from "lucide-react";

const features = [
  {
    icon: Cpu,
    title: "AI Architecture Generation",
    description: "Describe your system, AI maps it to nodes and edges on a live canvas.",
  },
  {
    icon: Share2,
    title: "Real-time Collaboration",
    description: "Live cursors, presence indicators, and shared node editing across your team.",
  },
  {
    icon: FileText,
    title: "Instant Spec Generation",
    description: "Export a complete Markdown technical spec directly from the canvas graph.",
  },
];

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen font-sans bg-base">
      <div className="hidden lg:flex lg:w-1/2 flex-col bg-surface border-r border-border p-12">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-brand" />
          <span className="text-copy-primary font-semibold text-sm tracking-tight">StackCanvas</span>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-sm">
          <h1 className="text-4xl font-bold text-copy-primary leading-tight tracking-tight mb-4">
            Design systems at the speed of thought.
          </h1>
          <p className="text-copy-secondary text-sm leading-relaxed mb-10">
            Describe your architecture in plain English. StackCanvas maps it to a shared canvas your whole team can refine in real time.
          </p>
          <ul className="space-y-6">
            {features.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-3">
                <div className="mt-0.5 h-8 w-8 rounded-xl bg-elevated flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-brand" />
                </div>
                <div>
                  <p className="text-copy-primary text-sm font-medium">{title}</p>
                  <p className="text-copy-muted text-sm mt-0.5 leading-snug">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-copy-faint text-xs">© 2026 StackCanvas. All rights reserved.</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-8">
        <SignUp />
      </div>
    </div>
  );
}
