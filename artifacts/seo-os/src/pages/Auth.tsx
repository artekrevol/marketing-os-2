import { SignIn } from "@clerk/react";
import { ShieldCheck } from "lucide-react";

export default function Auth() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-4 justify-center">
          <ShieldCheck className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <span className="font-serif text-xl">SEO OS</span>
        </div>
        <p className="text-[11px] uppercase tracking-widest text-ink-muted mb-4 text-center">
          Quality Gate sign-in
        </p>
        <SignIn routing="hash" />
      </div>
    </div>
  );
}
