import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils';

const RECENT_KEY = 'eton-recent-emojis';
const MAX_RECENT = 24;

type EmojiEntry = { emoji: string; keywords: string };
type EmojiGroup = { id: string; label: string; items: string };

/** Formato compacto: `emoji|palabras clave` separadas por espacios. */
const GROUPS: EmojiGroup[] = [
  {
    id: 'smileys',
    label: 'Sonrisas',
    items: `😀|feliz sonrisa 😃|feliz grande 😄|risa 😁|sonrisa dientes 😆|risa fuerte 😅|risa nerviosa sudor 🤣|risa rodando 😂|risa lagrimas 😊|sonrisa tierna 😇|angel inocente 🙂|sonrisa suave 🙃|al reves 😉|guiño😌|calma alivio 😍|enamorado corazon 🥰|enamorado cariño 😘|beso 😗|beso dulce 😙|beso 😚|beso cerrado 😋|rico sabroso lengua 😛|lengua 😝|lengua loca 😜|lengua guiño 🤪|loco tonto 🤨|ceja duda 🧐|monoculo examinar 🤓|friki gafas 😎|gafas genial 🥸|disfraz🤩|asombrado estrella 🥳|fiesta celebrar 😏|sonrisa picara 😒|aburrido 😞|triste decepcionado 😔|triste pensativo 😟|preocupado 😕|confundido 🙁|triste 😣|sufrir 😖|frustrado 😫|cansado agotado 😩|agotado placer 🥺|suplicar ternura 😢|llorar tristeza 😭|llorar fuertemente 😤|orgullo enfado 😠|enfado 😡|enfado rojo 🤬|enfado grosero 🤯|mente explosion 😳|sonrojo sorpresa 🥵|calor sofocado 🥶|frio congelado 😱|grito miedo 😨|miedo 😰|miedo sudor 😥|decepcion tristeza 😓|sudor agobio 🤗|abrazo calido 🤔|pensar duda 🤭|risa tacones mano boca 🤫|silencio secreto 🤥|mentira nariz 😶|sin boca silencio 😐|neutro indiferente 😑|sin expresion 😬|mueca tenso 🙄|ojos en blanco 😯|sorpresa 😦|asombrado 😧|angustiado 😮|sorpresa boca abierta 😲|asombro 🥱|bostezar aburrido 😴|dormir cansado 🤤|babar dormir 😪|somnoliento 😵|mareado aturdido 🤐|boca cerrada silencio 🥴|mareado borracho 🤢|nauseas 🤮|vomitar 🤧|estornudar resfriado 😷|mascara enfermedad 🤒|enfermo fiebre 🤕|vendado herida`,
  },
  {
    id: 'gestures',
    label: 'Gestos',
    items: `👋|hola adios saludo 🤚|mano levantada parar 🖐️|mano abierta dedos ✋|mano alta alto 🖖|vulcano saludo 👌|de acuerdo perfecto 🤌|pizca italiano 🤏|pizca pequeno ✌️|victoria paz 🤞|cruzar dedos suerte 🤟|te quiero lengua senas 🤘|cuernos rock metal 🤙|llamada telefono senas 👈|dedo izquierda 👉|dedo derecha 👆|dedo arriba 👇|dedo abajo ☝️|dedo uno arriba 👍|me gusta bien aprobado 👎|no me gusta malo ✊|puño cerrado fuerza 👊|puñetazo golpe 🤛|puño izquierdo 🤜|puño derecho 👏|aplauso felicitacion 🙌|manos arriba alegria 👐|manos abiertas abrazo 🤲|manos juntas oracion 🤝|apretar manos acuerdo trato 🙏|gracias oracion por favor ✍️|escribir firma 💪|musculo fuerte 🦾|brazo robotico 👀|ojos mirar 👂|oido escuchar 👃|nariz oler 🧠|cerebro inteligente 🫀|corazon organo 🗣️|hablar voz alta 👥|dos personas grupo 👤|persona perfil silueta`,
  },
  {
    id: 'hearts',
    label: 'Corazones',
    items: `❤️|corazon rojo amor 🧡|corazon naranja calidez 💛|corazon amarillo amistad 💚|corazon verde esperanza 💙|corazon azul confianza 💜|corazon morado adoracion 🖤|corazon negro luto 🤍|corazon blanco pureza 🤎|corazon marron 💔|corazon roto desamor ❣️|corazon exclamacion 💕|dos corazones enamorados 💞|corazones girando 💓|corazon latiendo 💗|corazon creciendo 💖|corazon brillante destello 💘|corazon flecha cupido 💝|corazon lazo regalo 💟|corazon decorado ♥️|corazon negro palo naipes 💌|carta amor mensaje`,
  },
  {
    id: 'animals',
    label: 'Animales',
    items: `🐶|perro cachorro 🐱|gato gatito 🐭|raton 🐹|hámster 🐰|conejo 🦊|zorro 🐻|oso 🐼|panda 🐨|koala 🐯|tigre 🦁|leon 🐮|vaca 🐷|cerdo 🐸|rana 🐵|mono 🙈|mono no ver mal 🙉|mono no oir mal 🙊|mono no hablar mal 🐔|gallina 🐧|pinguino 🐦|pajaro 🐤|pollito 🦆|pato 🦅|aguila 🦉|buho 🐺|lobo 🐗|jabali 🐴|caballo 🦄|unicornio 🐝|abeja 🐛|gusano oruga 🦋|mariposa 🐌|caracol 🐞|mariquita 🐜|hormiga 🕷️|araña 🦂|escorpion 🐢|tortuga 🐍|serpiente 🦎|lagarto 🦖|t rex dinosaurio 🦕|dinosaurio 🐙|pulpo 🦑|calamar 🦐|gamba camaron 🦀|cangrejo 🐡|pez globo 🐠|pez tropical 🐟|pez 🐬|delfin 🐳|ballena 🦈|tiburon 🐊|cocodrilo 🐅|tigre animal 🐆|leopardo 🦓|cebra 🦍|gorila 🦧|orangutan 🐘|elefante 🦛|hipopotamo 🦏|rinoceronte 🐪|camello 🐫|camello joroba 🦒|jirafa 🦘|canguro 🐃|buey 🐂|buey toro 🐄|vaca lechera 🐎|caballo carrera 🐖|cerdo granja 🐏|carnero 🐑|oveja 🦙|llama 🐐|cabra 🦌|ciervo 🐕|perro 🐈|gato doméstico 🐓|gallo 🦃|pavo 🦚|pavorreal 🦜|loro`,
  },
  {
    id: 'food',
    label: 'Comida',
    items: `🍎|manzana roja 🍐|pera 🍊|naranja mandarina 🍋|limon 🍌|banana platano 🍉|sandia 🍇|uvas 🍓|fresa 🫐|arandanos 🍈|melon 🍒|cerezas 🍑|melocoton durazno 🥭|mango 🍍|piña anana 🥥|coco 🥝|kiwi 🍅|tomate 🍆|berenjena 🥑|aguacate palta 🥦|brócoli 🥬|lechuga verduras 🥒|pepino 🌶️|chile picante 🌽|maiz 🥕|zanahoria 🧄|ajo 🧅|cebolla 🥔|patata papa 🍠|batata camote 🥐|croissant 🥯|panecillo 🍞|pan 🥖|baguette 🥨|pretzel 🧀|queso 🥚|huevo 🍳|huevo frito desayuno 🧈|mantequilla 🥞|panqueques tortitas 🧇|gofre 🥓|tocino 🥩|carne filete 🍗|pollo asado 🍖|chuleta costilla 🌭|perrito caliente 🍔|hamburguesa 🍟|papas fritas 🍕|pizza 🥪|sándwich 🥙|envuelto kebab 🧆|falafel 🌮|taco 🌯|burrito 🥗|ensalada 🥘|paella cazuela 🍝|pasta espaguetis 🍜|fideos ramen 🍲|caldo sopa 🍛|curry arroz 🍣|sushi 🍱|bento 🥟|empanada dumpling 🍤|gambas fritas 🍙|onigiri arroz 🍚|arroz 🍘|galleta arroz 🍥|narutomaki 🥠|fortuna galleta 🥮|pastel luna 🍢|brocheta 🍡|dango 🍧|nieve raspada 🍨|helado tazón 🍦|helado cono 🥧|pastel tarta 🧁|magdalena 🍰|pastel 🎂|cumpleaños 🍮|flan 🍭|paleta dulce 🍬|caramelo 🍫|chocolate 🍿|palomitas 🍩|dona 🍪|galleta galleta ☕|cafe te 🍵|te 🧃|jugo caja 🥤|refresco gaseosa 🍺|cerveza 🍻|cervezas brindis 🥂|brindis champan 🍷|vino tinto 🥃|whisky 🍸|coctel martini 🍹|coctel tropical 🍾|champan botella 🧊|hielo`,
  },
  {
    id: 'activity',
    label: 'Actividad',
    items: `⚽|futbol balon 🏀|baloncesto 🏈|futbol americano ⚾|beisbol 🥎|softbol 🎾|tenis 🏐|voleibol 🏉|rugby 🎱|billar 🏓|ping pong 🏸|bádminton 🥅|porteria red 🏒|hockey hielo 🏑|hockey hierba 🏏|críquet ⛳|golf 🏹|arco flecha 🎣|pescar caña 🥊|boxeo guantes 🥋|artes marciales judo 🎽|correr atletismo ⛸️|patinaje hielo 🛹|patineta 🛼|patines 🛷|trineo 🏄‍♂️|surf 🏊‍♂️|nadar 🤽‍♂️|waterpolo 🚴‍♂️|ciclista 🚵‍♂️|bicicleta montaña 🏋️‍♂️|pesas gimnasio 🤼‍♂️|lucha 🤸‍♂️|gimnasia voltereta ⛺|acampar tienda 🏕️|campamento 🏞️|parque naturaleza 🚣‍♂️|remar canoe 🧗‍♂️|escalar montaña 🗻|montaña fuji 🏔️|montana nieve 🌋|volcan ⛰️|pico montaña 🎯|diana blanco objetivo 🎮|videojuegos control 🎲|dados azar ♟️|ajedrez peon 🎨|pintura arte 🎤|microfono cantar 🎧|auriculares musica 🎷|saxofon 🎸|guitarra 🎹|piano 🎻|violin 🥁|tambor 🎺|trompeta 🎬|cine pelicula 🎉|fiesta celebracion 🎊|confeti 🎈|globo fiesta 🎁|regalo paquete 🎄|navidad arbol 🎃|halloween calabaza ✨|brillos destellos 🎆|fuegos artificiales 🎇|bengala fuegos`,
  },
  {
    id: 'travel',
    label: 'Viajes',
    items: `🚗|coche auto 🚕|taxi 🚙|todoterreno coche 🚌|autobus 🚎|trolebus 🏎️|coche carreras 🚓|policia coche 🚑|ambulancia 🚒|bomberos camion 🚐|furgoneta 🚚|camion entrega 🚛|camion pesado 🚜|tractor 🛵|motoneta 🏍️|motocicleta 🚲|bicicleta 🛴|patineta electrica 🚁|helicoptero ✈️|avion 🛫|avion despegue 🛬|avion aterrizaje 🚀|cohete espacio 🛸|ovni platillo 🚢|barco grande ⛵|velero 🚤|lancha 🛥️|yate ⚓|ancla puerto 🏖️|playa sombrilla 🏝️|isla tropical 🏜️|desierto arena 🗺️|mapa mundo 🧭|brujula norte 🗿|moai estatua 🗽|estatua libertad 🗼|torre eiffel 🏰|castillo 🏯|castillo japones 🏟️|estadio 🎡|rueda gigante 🎢|montana rusa 🎠|carrusel caballo ⛲|fuente agua ⛱️|sombrilla playa 🌃|ciudad noche 🌆|atardecer ciudad 🌇|atardecer 🌉|puente noche 🌌|via lacta espacio 🌠|estrella fugaz 🌙|luna noche 🌕|luna llena 🌖|luna menguante 🌗|luna cuarto 🌘|luna media 🌑|luna nueva 🌒|luna creciente`,
  },
  {
    id: 'objects',
    label: 'Objetos',
    items: `⌚|reloj pulsera 📱|telefono movil 💻|portatil ordenador ⌨️|teclado 🖥️|ordenador monitor 🖨️|impresora 🖱️|raton 💾|disquete guardar 💿|disco compacto 📀|disco 📷|camara fotografica 📸|camara flash 📹|videocamara 🎥|camara cine 📺|television 📻|radio ⏰|reloj alarma ⏳|reloj arena tiempo ⌛|reloj arena 📡|antena senal 🔋|bateria 🔌|enchufe corriente 💡|bombilla idea 🔦|linterna 🕯️|vela luz 🧯|extintor fuego 🛠️|herramientas martillo ⚙️|engranaje ajustes 🔧|llave inglesa 🔨|martillo 🧰|caja herramientas 🧲|imán 📎|sujetapapeles ✂️|tijeras cortar 📏|regla medir 📌|chincheta 📍|marcador ubicacion 📚|libros biblioteca 📖|libro abierto leer 📝|nota escribir ✏️|lapiz 🖊️|pluma boligrafo 🖍️|crayon 📁|carpeta archivo 📂|carpeta abierta 🗂️|divisores archivo 📅|calendario 📆|calendario dias 🗓️|calendario espiral 💼|maletin trabajo 🎒|mochila escuela 👜|bolso mano 👝|monedero 👛|cartera 💰|dinero bolsa 💳|tarjeta credito 💎|diamante gema 🔑|llave acceso 🗝️|llave antigua 🔒|candado cerrado 🔓|candado abierto 🧵|hilo costura 🪡|aguja 🧶|lana estambre 🪢|nudo atadura 📓|cuaderno 📔|cuaderno decorado 📕|libro rojo 📗|libro verde 📘|libro azul 📙|libro naranja 📐|escuadra compas 🧮|abaco calculo 🔬|microscopio 🔭|telescopio`,
  },
  {
    id: 'symbols',
    label: 'Símbolos',
    items: `✅|correcto hecho ✔️|aprobado ❌|equis error incorrecto ⭕|circulo rojoCorrecto ❗|exclamacion importante ❓|pregunta duda 💯|cien perfecto 💢|rabia simbolo 💥|colision explosion 💫|mareado estrellas 💦|gotas sudor 💨|viento humo 💬|burbuja mensaje conversación 💭|burbuja pensamiento 🗯️|burbuja enfado ♻️|reciclar ecologia ⚠️|advertencia peligro 🚫|prohibido no permitido ⛔|prohibido entrada 📛|etiqueta nombre 🔅|brillo suave 🔆|brillo fuerte 🔕|campana silenciada 🔔|campana notificacion ♩|nota musical ♪|nota musical doble ♫|melodia ♬|musica nota doble ⚡|rayo electrico rapido ☀️|sol buen tiempo 🌈|arcoiris orgullo ☁️|nube nublado 🌧️|lluvia ⛈️|tormenta trueno ❄️|copo nieve invierno ☃️|muñeco nieve 🔥|fuego calor moda 🌊|ola mar 🌱|brote planta nueva 🌿|hierba hoja 🍀|trebol suerte 🌸|flor cerezo primavera 🌺|hibisco flor tropical 🌻|girasol 🌼|manzanilla flor 🌷|tulipan 🕊️|paloma paz ⚖️|balanza justicia ley ⚔️|espadas pelea 🛡️|escudo proteccion 🏳️|bandera blanca 🏴|bandera negra 🏁|bandera cuadros meta 🚩|bandera roja marca 🎌|banderas japonesas 🏳️‍🌈|bandera arcoiris orgullo ❤️‍🔥|corazon en llamas pasion`,
  },
];

const ALL_EMOJIS: EmojiEntry[] = GROUPS.flatMap((group) =>
  group.items.trim().split(/\s+/).map((token) => {
    const separator = token.indexOf('|');
    return separator === -1
      ? { emoji: token, keywords: '' }
      : { emoji: token.slice(0, separator), keywords: token.slice(separator + 1) };
  }),
);

function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose?: () => void }) {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState('recent');
  const [recent, setRecent] = useState<string[]>(loadRecent);

  useEffect(() => {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* almacenamiento no disponible */ }
  }, [recent]);

  const keywordsByEmoji = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of ALL_EMOJIS) {
      map.set(entry.emoji, `${map.get(entry.emoji) ?? ''} ${entry.keywords}`.trim());
    }
    return map;
  }, []);

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es');
    if (!term) return null;
    return ALL_EMOJIS.filter(({ emoji, keywords }) =>
      emoji.includes(term) || keywords.toLocaleLowerCase('es').includes(term),
    ).filter((entry, index, list) => list.findIndex((item) => item.emoji === entry.emoji) === index);
  }, [query]);

  const currentGroup = GROUPS.find((group) => group.id === activeGroup);
  const groupEmojis = useMemo(() => {
    if (activeGroup === 'recent') return recent.map((emoji) => ({ emoji, keywords: keywordsByEmoji.get(emoji) ?? '' }));
    const group = GROUPS.find((item) => item.id === activeGroup);
    if (!group) return [];
    return group.items.trim().split(/\s+/).map((token) => {
      const separator = token.indexOf('|');
      return separator === -1
        ? { emoji: token, keywords: '' }
        : { emoji: token.slice(0, separator), keywords: token.slice(separator + 1) };
    }).filter((entry, index, list) => list.findIndex((item) => item.emoji === entry.emoji) === index);
  }, [activeGroup, keywordsByEmoji, recent]);

  const pick = (emoji: string) => {
    setRecent((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, MAX_RECENT));
    onPick(emoji);
  };

  const renderGrid = (label: string, entries: EmojiEntry[]) => (
    <section key={label} className="mb-2 last:mb-0">
      <p className="sticky top-0 z-10 bg-white/95 px-1 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg/35 backdrop-blur-xl dark:bg-[#1c1c1e]/95 dark:text-white/35">
        {label} <span className="font-normal normal-case tracking-normal opacity-50">{entries.length}</span>
      </p>
      <div className="grid grid-cols-8 gap-0.5">
        {entries.map(({ emoji }) => (
          <button
            key={emoji}
            type="button"
            onClick={() => pick(emoji)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[19px] leading-none transition-transform hover:scale-110 hover:bg-fg/[.07] active:scale-95 dark:hover:bg-white/[.1]"
            aria-label={`Insertar ${emoji}`}
            title={keywordsByEmoji.get(emoji) || emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div
      className="w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-[22px] border border-line/70 bg-white/95 shadow-lift backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c1c1e]/95"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="Selector de emojis"
    >
      <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2.5 dark:border-white/10">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/30 dark:text-white/35" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar emoji…"
            className="w-full rounded-xl border border-transparent bg-fg/[.05] py-1.5 pl-8 pr-2 text-[12px] text-fg/85 outline-none transition-colors placeholder:text-fg/30 focus:border-fg/15 dark:bg-white/[.08] dark:text-white/85 dark:placeholder:text-white/30 dark:focus:border-white/20"
          />
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fg/40 transition-colors hover:bg-fg/[.07] hover:text-fg/80 dark:text-white/40 dark:hover:bg-white/[.1] dark:hover:text-white/80"
            aria-label="Cerrar selector de emojis"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line/60 px-2 py-2 dark:border-white/10">
        {[{ id: 'recent', label: 'Recientes' }, ...GROUPS.map(({ id, label }) => ({ id, label }))].map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => { setActiveGroup(group.id); setQuery(''); }}
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors',
              activeGroup === group.id && !query
                ? 'bg-fg text-paper shadow-sm dark:bg-white/90 dark:text-[#1c1c1e]'
                : 'text-fg/45 hover:bg-fg/[.06] hover:text-fg/80 dark:text-white/45 dark:hover:bg-white/[.08] dark:hover:text-white/85',
            )}
          >
            {group.label}
          </button>
        ))}
      </div>

      <div className="max-h-60 overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
        {results ? (
          results.length
            ? renderGrid('Resultados', results)
            : (
              <p className="py-8 text-center text-[11px] text-fg/35 dark:text-white/35">
                No se encontraron emojis para «{query.trim()}»
              </p>
            )
        ) : groupEmojis.length ? (
          renderGrid(currentGroup?.label ?? 'Emojis', groupEmojis)
        ) : (
          <p className="py-8 text-center text-[11px] text-fg/35 dark:text-white/35">
            Aún no hay emojis recientes. Elige uno para guardarlo aquí.
          </p>
        )}
      </div>
    </div>
  );
}

export default EmojiPicker;
