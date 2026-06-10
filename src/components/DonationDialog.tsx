import { useState } from "react";
import { Copy, Check, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PIX_KEY = "0fd1dcd7-4db0-4888-bd44-6384b7d3d888";
const BTC_ADDRESS = "bc1qtf0y90vgxvq39wvypddzm034jz7c62xj7pf64x";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
        <code className="flex-1 text-sm font-mono break-all select-all">{value}</code>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopy}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function DonationDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 border-pink-500/30 hover:border-pink-500/60 hover:bg-pink-500/5 text-pink-500 hover:text-pink-500"
        >
          <Heart className="h-4 w-4" />
          Apoie o desenvolvedor
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-pink-500" />
            Apoie o desenvolvedor
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          App gratuito e sem anúncios. Se este app te ajuda, qualquer valor é muito bem-vindo!
        </p>
        <Tabs defaultValue="pix">
          <TabsList className="w-full">
            <TabsTrigger value="pix" className="flex-1">
              💸 PIX
            </TabsTrigger>
            <TabsTrigger value="btc" className="flex-1">
              ₿ Bitcoin
            </TabsTrigger>
          </TabsList>
          <TabsContent value="pix" className="space-y-3 pt-2">
            <CopyField label="Chave PIX (aleatória)" value={PIX_KEY} />
            <p className="text-xs text-muted-foreground">Nubank · Claudio Luciano Rico</p>
          </TabsContent>
          <TabsContent value="btc" className="space-y-3 pt-2">
            <CopyField label="Endereço Bitcoin" value={BTC_ADDRESS} />
            <p className="text-xs text-muted-foreground">Rede Bitcoin · Native SegWit (bc1)</p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
