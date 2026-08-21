import { describe, expect, it } from "vitest";
import {
  atribucionCita,
  citaExisteLiteral,
  contarPorOrigen,
  detectarVeto,
  esAceptacionExplicita,
  resolverConsentimiento,
  validarConsentimiento,
} from "@/lib/waConsent";

const TRANSCRIPCION_BELEN =
  "Sí, pero ¿dónde lo ha obtenido? Porque el número este está en la lista Robinson. " +
  "Somos gente bastante privada y es verdad que no, estamos en la lista Robinson por una razón. " +
  "Venga, me parece bien, pero vamos a tener que hablar de cómo habéis llegado a los teléfonos.";

const TRANSCRIPCION_OK =
  "Le puedo mandar la información. Vale, pues mándame el WhatsApp. Perfecto, ahora mismo se lo envío.";

describe("las tres comprobaciones de la cita", () => {
  it("exige que la cita exista literalmente en la transcripción", () => {
    expect(citaExisteLiteral(TRANSCRIPCION_OK, "Vale, pues mándame el WhatsApp.")).toBe(true);
    expect(citaExisteLiteral(TRANSCRIPCION_OK, "Sí, mándame un WhatsApp a ese número.")).toBe(false);
  });

  it("atribuye al propietario quien pide recibir y al comercial quien ofrece enviar", () => {
    expect(atribucionCita("Vale, pues mándame el WhatsApp.")).toBe("propietario");
    expect(atribucionCita("Ahora te mando un WhatsApp con la información.")).toBe("comercial");
    expect(atribucionCita("Muy bien, pues de acuerdo.")).toBe("desconocida");
  });

  it("exige aceptación explícita de recibir el mensaje", () => {
    expect(esAceptacionExplicita("Por WhatsApp mándamelo mejor, que me pierdo con los correos.")).toBe(true);
    expect(esAceptacionExplicita("Perfecto, muy bien. Perfecto, no hay ningún problema.")).toBe(false);
    expect(esAceptacionExplicita("El propietario ha autorizado por teléfono el envío de WhatsApp.")).toBe(false);
  });
});

describe("veto automático", () => {
  it("bloquea por lista Robinson, protección de datos, baja y queja por el origen del dato", () => {
    expect(detectarVeto(TRANSCRIPCION_BELEN).vetado).toBe(true);
    expect(detectarVeto(TRANSCRIPCION_BELEN).motivos).toContain("lista_robinson");
    expect(detectarVeto("Quiero que me den de baja y borren mis datos.").vetado).toBe(true);
    expect(detectarVeto("Muy bien, hablamos la semana que viene.").vetado).toBe(false);
  });
});

describe("validarConsentimiento", () => {
  it("un caso que antes pasaba ahora va a dudoso (Belén: veto + cita no atribuible)", () => {
    const r = validarConsentimiento({
      veredicto: "autorizado",
      cita: "Venga, me parece bien, pero vamos a tener que hablar de cómo habéis llegado a los teléfonos",
      transcripcion: TRANSCRIPCION_BELEN,
      telefonoLlamada: "+34686292621",
      telefonoFicha: "+34916326524",
    });
    expect(r.veredicto).toBe("dudoso");
    expect(r.apto_para_escritura).toBe(false);
    expect(r.motivos).toContain("veto_privacidad");
    expect(r.motivos).toContain("cita_no_atribuible_al_propietario");
    expect(r.motivos).toContain("telefono_distinto_al_de_la_ficha");
  });

  it("una frase de cortesía sin mención a WhatsApp no autoriza nada", () => {
    const r = validarConsentimiento({
      veredicto: "autorizado",
      cita: "Muy bien, pues de acuerdo.",
      transcripcion: "Muy bien, pues de acuerdo. Un saludo.",
    });
    expect(r.veredicto).toBe("dudoso");
    expect(r.motivos).toContain("sin_aceptacion_explicita_de_whatsapp");
  });

  it("una cita real, atribuida y explícita sí autoriza", () => {
    const r = validarConsentimiento({
      veredicto: "autorizado",
      cita: "Vale, pues mándame el WhatsApp.",
      transcripcion: TRANSCRIPCION_OK,
      telefonoLlamada: "+34600111222",
      telefonoFicha: "600111222",
    });
    expect(r.veredicto).toBe("autorizado");
    expect(r.apto_para_escritura).toBe(true);
    expect(r.motivos).toEqual([]);
  });

  it("una cita inventada que no aparece en la transcripción va a dudoso", () => {
    const r = validarConsentimiento({
      veredicto: "autorizado",
      cita: "Sí, mándame un WhatsApp a ese mismo teléfono.",
      transcripcion: TRANSCRIPCION_OK,
    });
    expect(r.motivos).toContain("cita_no_encontrada_en_transcripcion");
    expect(r.veredicto).toBe("dudoso");
  });
});

describe("revocación: manda la señal más reciente", () => {
  const o = "owner-1";

  it("un no posterior gana al sí anterior", () => {
    const r = resolverConsentimiento(
      [
        { owner_id: o, veredicto: "autorizado", fecha_llamada: "2026-03-01T10:00:00Z" },
        { owner_id: o, veredicto: "rechazado", fecha_llamada: "2026-08-20T10:00:00Z" },
      ],
      o,
    );
    expect(r.autorizado).toBe(false);
    expect(r.revocado).toBe(true);
  });

  it("un sí posterior a un no vuelve a autorizar", () => {
    const r = resolverConsentimiento(
      [
        { owner_id: o, veredicto: "rechazado", fecha_llamada: "2026-03-01T10:00:00Z" },
        { owner_id: o, veredicto: "autorizado", fecha_llamada: "2026-08-20T10:00:00Z", origen: "sistema" },
      ],
      o,
    );
    expect(r.autorizado).toBe(true);
    expect(r.origen).toBe("sistema");
  });

  it("una señal en revisión no autoriza", () => {
    const r = resolverConsentimiento(
      [{ owner_id: o, veredicto: "autorizado", fecha_llamada: "2026-08-20T10:00:00Z", review_status: "pendiente_revision" }],
      o,
    );
    expect(r.autorizado).toBe(false);
  });
});

describe("contadores separados por origen", () => {
  it("no mezcla lo que marcó el cliente con lo que propuso el sistema", () => {
    const c = contarPorOrigen([
      { veredicto: "autorizado", fuente: "hubspot" },
      { veredicto: "autorizado", origen: "sistema" },
      { veredicto: "autorizado", origen: "comercial" },
      { veredicto: "rechazado", origen: "sistema" },
    ]);
    expect(c).toEqual({ cliente: 1, sistema: 1, comercial: 1, revocacion: 0 });
  });
});
