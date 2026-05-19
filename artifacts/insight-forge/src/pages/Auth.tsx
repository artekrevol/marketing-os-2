import { SignIn } from "@clerk/react";
import { NotebookPen } from "lucide-react";

export default function Auth() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <NotebookPen className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <span className="font-serif text-2xl tracking-tight">ContentForge</span>
        </div>
        <SignIn />
      </div>
    </div>
  );
}
