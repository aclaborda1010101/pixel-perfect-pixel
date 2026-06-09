import React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
  resetKey?: string;
}
interface State {
  error: Error | null;
}

export class RuntimeErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[RuntimeErrorBoundary]", error, info);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              {this.props.fallbackTitle ?? "Algo ha fallado al renderizar esta pantalla"}
            </h2>
            <p className="font-mono text-xs text-muted-foreground">
              {this.state.error.message}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Recargar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (window.location.href = "/comercial/edificios")}>
              Volver a la cartera
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}