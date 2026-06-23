import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

function LocationsInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["seo", "locations", brandId],
    queryFn: () => seo.listLocations(brandId),
  });

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [country, setCountry] = useState("");
  const [lang, setLang] = useState("en");

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["seo", "locations", brandId] });

  const createM = useMutation({
    mutationFn: () =>
      seo.createLocation({
        brandId,
        name: name.trim(),
        dataforseoLocationCode: Number(code),
        countryCode: country.trim() || null,
        languageCode: lang.trim() || "en",
      }),
    onSuccess: () => {
      toast.success("Location added");
      setName("");
      setCode("");
      setCountry("");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => seo.deleteLocation(brandId, id),
    onSuccess: () => {
      toast.success("Location removed");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canCreate = name.trim().length > 0 && Number.isInteger(Number(code)) && code !== "";

  const rows = listQ.data ?? [];

  return (
    <SeoShell title="Locations" subtitle="DataForSEO target locations for rank tracking">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) createM.mutate();
        }}
        className="border border-rule rounded-md bg-background p-4 mb-6 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
      >
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="United States"
            className="input"
          />
        </Field>
        <Field label="DataForSEO code">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="2840"
            className="input"
          />
        </Field>
        <Field label="Country">
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="US"
            className="input"
          />
        </Field>
        <Field label="Language">
          <input value={lang} onChange={(e) => setLang(e.target.value)} className="input" />
        </Field>
        <button
          type="submit"
          disabled={!canCreate || createM.isPending}
          className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {createM.isPending ? "Adding…" : "Add location"}
        </button>
      </form>

      {listQ.isLoading ? (
        <StateBox>Loading locations…</StateBox>
      ) : rows.length === 0 ? (
        <StateBox>No locations yet. Add one above to start tracking.</StateBox>
      ) : (
        <div className="border border-rule rounded-md bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th>Country</Th>
                <Th>Lang</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-rule">
                  <Td className="font-medium">{l.name}</Td>
                  <Td className="font-mono text-xs">{l.dataforseoLocationCode}</Td>
                  <Td>{l.countryCode ?? "—"}</Td>
                  <Td>{l.languageCode}</Td>
                  <Td className="text-right">
                    <button
                      onClick={() => deleteM.mutate(l.id)}
                      className="text-ink-muted hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SeoShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-medium px-4 py-2">{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}

export default withBrand("Locations", undefined, (brandId) => (
  <LocationsInner brandId={brandId} />
));
