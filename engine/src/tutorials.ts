/**
 * How to do each fix, in words a business owner can follow. One entry for every check that is built.
 *
 * `owner: true` means a person with admin access to their website and no technical skills can do it, with the steps for
 * the platforms most of our clients use (WordPress and Shopify) and a general version for any other. `owner: false`
 * means it needs a developer or an AI coding assistant: the steps then say what it is for, whether it matters to them,
 * and how to hand it over. Menu names change between versions of WordPress, Shopify and their plugins, so the page
 * says so once rather than pretending to be exact.
 */
import type { Bilingual } from "./guide"

export interface Tutorial {
  owner: boolean
  /** The general steps, used for any platform without its own */
  steps: Bilingual[]
  platforms?: Partial<Record<"wordpress" | "shopify", Bilingual[]>>
}

const b = (en: string, id: string): Bilingual => ({ en, id })

const HAND_OVER = b(
  "If you want this, copy the prompt below and give it to your web developer or an AI coding assistant. They know what to do with it.",
  "Kalau Anda menginginkannya, salin prompt di bawah dan berikan ke web developer Anda atau asisten AI untuk coding. Mereka tahu apa yang harus dilakukan."
)
const OPTIONAL = b(
  "If you do not need it yet, you can leave it. Nothing breaks without it.",
  "Kalau belum perlu, boleh dibiarkan dulu. Tidak ada yang rusak tanpa ini."
)

/** A fix only a developer can do, that matters little to most businesses. */
const devBonus = (what: Bilingual): Tutorial => ({
  owner: false,
  steps: [
    b(`This one is technical and optional. ${what.en}`, `Yang ini teknis dan tidak wajib. ${what.id}`),
    HAND_OVER,
    OPTIONAL,
  ],
})

/** A fix only a developer can do, that matters to every business. */
const devNeeded = (what: Bilingual): Tutorial => ({
  owner: false,
  steps: [
    b(`This one needs a developer. ${what.en}`, `Yang ini perlu developer. ${what.id}`),
    HAND_OVER,
    b("Tell them to use the Re-check button on this page when they are done. It confirms the fix for you.",
      "Minta mereka menekan tombol Periksa ulang di halaman ini setelah selesai. Tombol itu akan mengonfirmasi perbaikannya untuk Anda."),
  ],
})

export const TUTORIALS: Record<string, Tutorial> = {
  robots_txt: {
    owner: true,
    steps: [
      b("A small file called robots.txt tells visitors like Google and AI assistants where they may look. Your website does not have a working one.", "File kecil bernama robots.txt memberi tahu pengunjung seperti Google dan asisten AI bagian mana yang boleh dilihat. Website Anda belum punya yang berfungsi."),
      b("Ask whoever manages your website or hosting to add a robots.txt file to the main folder of the website. The simplest version just allows everyone in.", "Minta pengelola website atau hosting Anda menambahkan file robots.txt ke folder utama website. Versi paling sederhana hanya mengizinkan semua pengunjung masuk."),
    ],
    platforms: {
      wordpress: [
        b("WordPress makes this file for you. If it is missing, something is blocking it, often a security or caching plugin.", "WordPress membuat file ini sendiri. Kalau tidak ada, ada yang memblokirnya, biasanya plugin keamanan atau cache."),
        b("Open your SEO plugin. In Yoast SEO go to Tools, then File editor. In Rank Math go to General Settings, then Edit robots.txt.", "Buka plugin SEO Anda. Di Yoast SEO buka Tools, lalu File editor. Di Rank Math buka General Settings, lalu Edit robots.txt."),
        b("If the file is empty, create it and save. If you have no SEO plugin, switch off any plugin that says it blocks bots, then check again.", "Kalau file kosong, buat lalu simpan. Kalau Anda tidak punya plugin SEO, matikan plugin yang menyebut memblokir bot, lalu periksa lagi."),
      ],
      shopify: [
        b("Shopify creates this file for you automatically, so there is normally nothing to do.", "Shopify membuat file ini otomatis, jadi biasanya tidak ada yang perlu dikerjakan."),
        b("If it is missing or looks wrong, contact Shopify support or the developer who edited your theme.", "Kalau tidak ada atau terlihat salah, hubungi dukungan Shopify atau developer yang mengubah tema Anda."),
      ],
    },
  },

  ai_crawlers_allowed: {
    owner: true,
    steps: [
      b("Your website tells some AI assistants to stay away. If that is not on purpose, they cannot recommend you.", "Website Anda menyuruh sebagian asisten AI menjauh. Kalau itu tidak disengaja, mereka tidak bisa merekomendasikan Anda."),
      b("Decide first: do you want these AI assistants to be able to read your website? Most businesses that want to be found say yes.", "Putuskan dulu: apakah Anda ingin asisten AI ini bisa membaca website Anda? Kebanyakan bisnis yang ingin ditemukan menjawab ya."),
      b("If yes, open your robots.txt file and remove the lines that block them. They look like 'Disallow: /' under a name such as GPTBot or ClaudeBot.", "Kalau ya, buka file robots.txt Anda dan hapus baris yang memblokir mereka. Bentuknya 'Disallow: /' di bawah nama seperti GPTBot atau ClaudeBot."),
      b("Also look in the settings of any security plugin or protection service in front of your website (for example Cloudflare) for a switch that blocks AI bots, and turn it off.", "Periksa juga pengaturan plugin keamanan atau layanan perlindungan di depan website Anda (misalnya Cloudflare) untuk saklar yang memblokir bot AI, lalu matikan."),
    ],
    platforms: {
      wordpress: [
        b("Decide first: do you want these AI assistants to be able to read your website? Most businesses that want to be found say yes.", "Putuskan dulu: apakah Anda ingin asisten AI ini bisa membaca website Anda? Kebanyakan bisnis yang ingin ditemukan menjawab ya."),
        b("In your SEO plugin open the robots.txt editor (Yoast SEO: Tools, File editor. Rank Math: General Settings, Edit robots.txt) and remove the lines that block them, such as 'Disallow: /' under GPTBot or ClaudeBot.", "Di plugin SEO buka editor robots.txt (Yoast SEO: Tools, File editor. Rank Math: General Settings, Edit robots.txt) lalu hapus baris yang memblokir mereka, seperti 'Disallow: /' di bawah GPTBot atau ClaudeBot."),
        b("Check any security plugin (Wordfence, Sucuri and similar) and your protection service (for example Cloudflare) for a switch that blocks AI bots, and turn it off.", "Periksa plugin keamanan (Wordfence, Sucuri, dan sejenisnya) dan layanan perlindungan Anda (misalnya Cloudflare) untuk saklar yang memblokir bot AI, lalu matikan."),
      ],
    },
  },

  sitemap: {
    owner: true,
    steps: [
      b("A sitemap is a list of all your pages. It helps search engines and AI assistants find everything you sell.", "Sitemap adalah daftar semua halaman Anda. Ini membantu mesin pencari dan asisten AI menemukan semua yang Anda jual."),
      b("Ask whoever manages your website to create a sitemap and to mention it in the robots.txt file. Most website builders have a switch for it.", "Minta pengelola website Anda membuat sitemap dan menyebutkannya di file robots.txt. Kebanyakan pembuat website punya saklar untuknya."),
    ],
    platforms: {
      wordpress: [
        b("WordPress and the SEO plugins make a sitemap for you. You only need to make sure it is switched on.", "WordPress dan plugin SEO membuat sitemap untuk Anda. Anda hanya perlu memastikan fiturnya menyala."),
        b("In Yoast SEO go to Settings, then Site features, and switch on XML sitemaps. In Rank Math open Sitemap Settings and switch on the sitemap.", "Di Yoast SEO buka Settings, lalu Site features, dan nyalakan XML sitemaps. Di Rank Math buka Sitemap Settings dan nyalakan sitemap."),
        b("Make sure no plugin switches the sitemap off, and that your robots.txt mentions it. Your SEO plugin usually does this by itself.", "Pastikan tidak ada plugin yang mematikan sitemap, dan robots.txt Anda menyebutkannya. Plugin SEO biasanya melakukannya sendiri."),
      ],
      shopify: [
        b("Shopify makes the sitemap for you, so there is normally nothing to do.", "Shopify membuat sitemap untuk Anda, jadi biasanya tidak ada yang perlu dikerjakan."),
        b("If this check still fails, contact Shopify support and ask why your sitemap is not available.", "Kalau pemeriksaan ini masih gagal, hubungi dukungan Shopify dan tanyakan kenapa sitemap Anda tidak tersedia."),
      ],
    },
  },

  raw_html_content: devNeeded(b(
    "Your pages only show their text after scripts run in the browser. AI assistants do not run those scripts, so they may see an empty page.",
    "Halaman Anda baru menampilkan teksnya setelah skrip berjalan di browser. Asisten AI tidak menjalankan skrip itu, jadi mereka bisa melihat halaman kosong."
  )),

  redirects_clean: devNeeded(b(
    "When someone opens your address with or without www, or with http instead of https, they should reach the right page in one step. Yours takes too many steps or loops.",
    "Ketika orang membuka alamat Anda dengan atau tanpa www, atau dengan http alih-alih https, mereka harus sampai ke halaman yang benar dalam satu langkah. Punya Anda terlalu banyak langkah atau berputar."
  )),

  public_no_login: {
    owner: true,
    steps: [
      b("Your website asks for a password or a login before showing anything. AI assistants cannot get in, so they cannot recommend you.", "Website Anda meminta kata sandi atau login sebelum menampilkan apa pun. Asisten AI tidak bisa masuk, jadi tidak bisa merekomendasikan Anda."),
      b("If the website is meant to be public, switch the password off. If it is a test version that is meant to stay private, you can ignore this.", "Kalau website memang untuk umum, matikan kata sandinya. Kalau itu versi uji yang memang harus pribadi, abaikan saja."),
      b("Check for a 'coming soon' or 'maintenance' mode and switch it off too.", "Periksa juga mode 'coming soon' atau 'maintenance' dan matikan."),
    ],
    platforms: {
      wordpress: [
        b("If the website is meant to be public, switch off any 'coming soon' or 'maintenance mode' plugin. Look in Plugins for a name that says so and deactivate it.", "Kalau website memang untuk umum, matikan plugin 'coming soon' atau 'maintenance mode'. Cari di Plugins nama yang menyebutnya, lalu nonaktifkan."),
        b("Ask your hosting provider whether a password is set on the whole website (some hosts offer 'password protect' for a site) and switch it off.", "Tanyakan ke penyedia hosting apakah seluruh website diberi kata sandi (beberapa hosting punya 'password protect' untuk situs) dan matikan."),
      ],
      shopify: [
        b("In your Shopify admin go to Online Store, then Preferences.", "Di admin Shopify buka Online Store, lalu Preferences."),
        b("Find the store password section (Private mode or Password protection) and switch it off, then save.", "Cari bagian kata sandi toko (Private mode atau Password protection) dan matikan, lalu simpan."),
        b("A store on a trial plan or a development store cannot remove the password until it moves to a paid plan.", "Toko dengan paket percobaan atau development store tidak bisa menghapus kata sandi sampai pindah ke paket berbayar."),
      ],
    },
  },

  not_noindex: {
    owner: true,
    steps: [
      b("Your website tells search engines and AI assistants not to list it. If that is not on purpose, nobody will find you.", "Website Anda menyuruh mesin pencari dan asisten AI tidak mendaftarkannya. Kalau itu tidak disengaja, tidak ada yang akan menemukan Anda."),
      b("Open the setting that hides your website from search and switch it off. It is usually a checkbox in the website's settings or in the SEO tool.", "Buka pengaturan yang menyembunyikan website dari pencarian dan matikan. Biasanya berupa kotak centang di pengaturan website atau di alat SEO."),
    ],
    platforms: {
      wordpress: [
        b("In WordPress go to Settings, then Reading.", "Di WordPress buka Settings, lalu Reading."),
        b("Find 'Search engine visibility' and untick 'Discourage search engines from indexing this site'. Click Save Changes.", "Cari 'Search engine visibility' dan hilangkan centang 'Discourage search engines from indexing this site'. Klik Save Changes."),
        b("Then open your SEO plugin and check that your homepage is not set to 'noindex' or hidden from search.", "Lalu buka plugin SEO Anda dan pastikan beranda tidak diatur 'noindex' atau disembunyikan dari pencarian."),
      ],
      shopify: [
        b("Shopify only hides pages when a theme setting or an app does it. Check the apps you installed for SEO or 'hide from search' options and switch them off.", "Shopify hanya menyembunyikan halaman kalau pengaturan tema atau aplikasi yang melakukannya. Periksa aplikasi SEO atau opsi 'hide from search' yang Anda pasang dan matikan."),
        b("If you cannot find it, ask your theme's support or your developer to remove the 'noindex' instruction from the homepage.", "Kalau tidak ketemu, minta dukungan tema atau developer Anda menghapus instruksi 'noindex' dari beranda."),
      ],
    },
  },

  not_found_markdown: devNeeded(b(
    "When a page does not exist, your website should give a clear, readable message that points to the right place. Yours leaves AI assistants at a dead end.",
    "Ketika halaman tidak ada, website Anda harus memberi pesan yang jelas dan terbaca yang menunjuk ke tempat yang benar. Punya Anda membuat asisten AI buntu."
  )),

  jsonld_organization: {
    owner: true,
    steps: [
      b("AI assistants look for a short, structured 'business card' on your website: who you are, your logo and your address. Yours is missing.", "Asisten AI mencari 'kartu nama' singkat dan terstruktur di website Anda: siapa Anda, logo, dan alamat. Milik Anda belum ada."),
      b("Fill in your business name and logo in your SEO tool, if it has the place for it.", "Isi nama bisnis dan logo Anda di alat SEO, kalau ada tempatnya."),
      b("The check also looks for a short description of your business. If your plugin has no field for it, use the prepared code below, which includes one. Read it and correct it first.", "Pemeriksaan ini juga mencari deskripsi singkat bisnis Anda. Kalau plugin Anda tidak punya kolom untuknya, pakai kode yang sudah disiapkan di bawah, yang sudah memuatnya. Baca dulu dan perbaiki yang salah."),
    ],
    platforms: {
      wordpress: [
        b("In Yoast SEO go to Settings, then Site basics, and fill in your organization name and logo. In Rank Math go to Titles and Meta, then Local SEO, and fill in your business details.", "Di Yoast SEO buka Settings, lalu Site basics, dan isi nama organisasi serta logo. Di Rank Math buka Titles and Meta, lalu Local SEO, dan isi detail bisnis."),
        b("The check also looks for a short description of your business. If your plugin has no field for it, use the prepared code below, which includes one. Read it and correct it first.", "Pemeriksaan ini juga mencari deskripsi singkat bisnis Anda. Kalau plugin Anda tidak punya kolom untuknya, pakai kode yang sudah disiapkan di bawah, yang sudah memuatnya. Baca dulu dan perbaiki yang salah."),
      ],
      shopify: [
        b("Shopify themes often include a basic business card already. If yours does not, or it has no description of your business, use the prepared code below.", "Tema Shopify sering sudah punya kartu nama dasar. Kalau milik Anda belum, atau belum ada deskripsi bisnis Anda, pakai kode yang sudah disiapkan di bawah."),
      ],
    },
  },

  organization_completeness: {
    owner: true,
    steps: [
      b("Your business card for AI assistants has your name, but not how to reach you: a phone number or email and your address.", "Kartu nama bisnis Anda untuk asisten AI sudah punya nama, tetapi belum cara menghubungi Anda: nomor telepon atau email dan alamat."),
      b("Add your contact phone number or email, and your street address, to the business details in your SEO tool.", "Tambahkan nomor telepon atau email kontak, dan alamat jalan, ke detail bisnis di alat SEO Anda."),
    ],
    platforms: {
      wordpress: [
        b("In Rank Math go to Titles and Meta, then Local SEO, and fill in phone, email and address. Yoast SEO needs its Local SEO add-on for these details.", "Di Rank Math buka Titles and Meta, lalu Local SEO, dan isi telepon, email, dan alamat. Yoast SEO butuh add-on Local SEO untuk detail ini."),
        b("Without these plugins, or if you want it exact, use the prepared code below. We filled it in from your own contact page.", "Tanpa plugin itu, atau kalau Anda ingin persis, pakai kode yang sudah disiapkan di bawah. Kami mengisinya dari halaman kontak Anda sendiri."),
      ],
      shopify: [
        b("Use the prepared code below. We filled it in from your own contact page, so please read it and correct anything that is wrong first.", "Pakai kode yang sudah disiapkan di bawah. Kami mengisinya dari halaman kontak Anda sendiri, jadi baca dulu dan perbaiki yang salah."),
      ],
    },
  },

  metadata_complete: {
    owner: true,
    steps: [
      b("Each page should have a clear title and a one-sentence description. Search engines and AI assistants use them to explain what the page is.", "Setiap halaman harus punya judul yang jelas dan deskripsi satu kalimat. Mesin pencari dan asisten AI memakainya untuk menjelaskan isi halaman."),
      b("Write a title and a description for your homepage and your most important pages. Keep the title short and the description to one or two sentences about what you offer.", "Tulis judul dan deskripsi untuk beranda dan halaman terpenting. Buat judul singkat dan deskripsi satu atau dua kalimat tentang apa yang Anda tawarkan."),
    ],
    platforms: {
      wordpress: [
        b("Open a page in WordPress and scroll to the Yoast SEO or Rank Math box under the text.", "Buka halaman di WordPress dan gulir ke kotak Yoast SEO atau Rank Math di bawah teks."),
        b("Fill in the SEO title and the meta description. For the homepage, use the SEO plugin's settings for the homepage if it does not use a normal page.", "Isi SEO title dan meta description. Untuk beranda, pakai pengaturan beranda di plugin SEO kalau beranda bukan halaman biasa."),
        b("Repeat for your key pages and products.", "Ulangi untuk halaman dan produk utama."),
      ],
      shopify: [
        b("In your Shopify admin go to Online Store, then Preferences. Fill in the Homepage title and Meta description, then save.", "Di admin Shopify buka Online Store, lalu Preferences. Isi Homepage title dan Meta description, lalu simpan."),
        b("For a product, a page or a collection, open it and click 'Edit' in the 'Search engine listing' box to write its title and description.", "Untuk produk, halaman, atau koleksi, buka lalu klik 'Edit' di kotak 'Search engine listing' untuk menulis judul dan deskripsinya."),
      ],
    },
  },

  pricing_structured: devNeeded(b(
    "Your product prices are not marked in a way AI assistants can read, so they may not know what things cost.",
    "Harga produk Anda belum ditandai dengan cara yang bisa dibaca asisten AI, jadi mereka mungkin tidak tahu harganya."
  )),

  trust_pages: {
    owner: true,
    steps: [
      b("Shoppers and AI assistants trust a business more when it has an About page, a Contact page and a Privacy policy. At least one of these is missing or too short.", "Pembeli dan asisten AI lebih percaya pada bisnis yang punya halaman Tentang, halaman Kontak, dan Kebijakan Privasi. Setidaknya satu belum ada atau terlalu pendek."),
      b("Write the missing page in your own words: who you are, how to reach you, and how you handle customer information.", "Tulis halaman yang kurang dengan kata-kata Anda sendiri: siapa Anda, cara menghubungi Anda, dan cara Anda menangani informasi pelanggan."),
      b("Link all three from the footer of your website, so they are easy to find.", "Tautkan ketiganya dari footer website, supaya mudah ditemukan."),
    ],
    platforms: {
      wordpress: [
        b("In WordPress go to Pages, then Add New. Create the About page, the Contact page and the Privacy page, and publish each one.", "Di WordPress buka Pages, lalu Add New. Buat halaman Tentang, Kontak, dan Privasi, lalu terbitkan masing-masing."),
        b("For the privacy page, go to Settings, then Privacy, and choose the page you made. WordPress can also suggest a template text there.", "Untuk halaman privasi, buka Settings, lalu Privacy, dan pilih halaman yang Anda buat. WordPress juga bisa menyarankan teks contoh di sana."),
        b("Add the three pages to the footer menu: Appearance, then Menus (or the Site Editor in newer themes).", "Tambahkan ketiga halaman ke menu footer: Appearance, lalu Menus (atau Site Editor di tema yang lebih baru)."),
      ],
      shopify: [
        b("In your Shopify admin go to Online Store, then Pages, and click Add page. Create the About page and the Contact page.", "Di admin Shopify buka Online Store, lalu Pages, dan klik Add page. Buat halaman Tentang dan halaman Kontak."),
        b("For the privacy policy go to Settings, then Policies, and click 'Create from template' for the Privacy policy, then edit and save it.", "Untuk kebijakan privasi buka Settings, lalu Policies, dan klik 'Create from template' pada Privacy policy, lalu edit dan simpan."),
        b("Add the pages to your footer: Online Store, then Navigation, then Footer menu.", "Tambahkan halaman ke footer: Online Store, lalu Navigation, lalu Footer menu."),
      ],
    },
  },

  markdown_negotiation: devNeeded(b(
    "It lets an AI assistant ask for a lighter, text-only version of each page, which is quicker and cheaper for it to read.",
    "Ini memungkinkan asisten AI meminta versi teks yang lebih ringan dari tiap halaman, yang lebih cepat dan murah dibaca."
  )),

  llms_txt: {
    owner: false,
    steps: [
      b("A short text file, llms.txt, that introduces your business to AI assistants and lists your most important pages. It is optional, and quick to add.", "File teks singkat, llms.txt, yang memperkenalkan bisnis Anda ke asisten AI dan mendaftar halaman terpenting. Tidak wajib, dan cepat ditambahkan."),
      b("Write down in a few sentences what you do, who you serve and which pages matter most (about, products, delivery, returns).", "Tulis dalam beberapa kalimat apa yang Anda lakukan, siapa pelanggan Anda, dan halaman mana yang paling penting (tentang, produk, pengiriman, pengembalian)."),
      HAND_OVER,
      OPTIONAL,
    ],
    platforms: {
      wordpress: [
        b("Some SEO plugins can make this file for you. In Yoast SEO look under Settings, Site features for an llms.txt switch. Rank Math has one as well in its newer versions.", "Beberapa plugin SEO bisa membuat file ini untuk Anda. Di Yoast SEO cari saklar llms.txt di Settings, Site features. Rank Math juga punya di versi barunya."),
        b("If your plugin does not have it, write a few sentences about your business and the pages that matter most, and give them to your developer to add as a file.", "Kalau plugin Anda tidak punya, tulis beberapa kalimat tentang bisnis dan halaman terpenting, lalu berikan ke developer untuk ditambahkan sebagai file."),
        b("It is optional: nothing breaks without it.", "Ini tidak wajib: tidak ada yang rusak tanpanya."),
      ],
    },
  },

  agents_md: {
    owner: false,
    steps: [
      b("A short guide to your website for AI assistants that act for customers: what you offer, how ordering works and which pages matter. It is optional.", "Panduan singkat tentang website Anda untuk asisten AI yang bertindak atas nama pelanggan: apa yang Anda tawarkan, cara pemesanan, dan halaman yang penting. Tidak wajib."),
      b("Write a few sentences about your business and how a customer orders from you or gets in touch.", "Tulis beberapa kalimat tentang bisnis Anda dan cara pelanggan memesan atau menghubungi Anda."),
      HAND_OVER,
      OPTIONAL,
    ],
  },

  content_signals: {
    owner: true,
    steps: [
      b("You can tell AI companies what they may do with your content. There are three choices, and only you can decide them.", "Anda bisa memberi tahu perusahaan AI apa yang boleh mereka lakukan dengan konten Anda. Ada tiga pilihan, dan hanya Anda yang bisa memutuskannya."),
      b("1. May they train their AI models on your content? 2. May your content appear in AI search results? 3. May an AI use your content to answer a customer's question? Most businesses that want to be found say no, yes, yes.", "1. Bolehkah mereka melatih model AI dengan konten Anda? 2. Bolehkah konten Anda muncul di hasil pencarian AI? 3. Bolehkah AI memakai konten Anda untuk menjawab pertanyaan pelanggan? Kebanyakan bisnis yang ingin ditemukan menjawab tidak, ya, ya."),
      b("Add one line to your robots.txt file with your answers, for example: Content-Signal: ai-train=no, search=yes, ai-input=yes", "Tambahkan satu baris ke file robots.txt dengan jawaban Anda, misalnya: Content-Signal: ai-train=no, search=yes, ai-input=yes"),
    ],
    platforms: {
      wordpress: [
        b("Decide your three answers first: may AI train on your content, may it appear in AI search, and may AI use it to answer customers. Most businesses that want to be found say no, yes, yes.", "Putuskan dulu tiga jawaban Anda: bolehkah AI melatih diri dengan konten Anda, bolehkah muncul di pencarian AI, dan bolehkah AI memakainya untuk menjawab pelanggan. Kebanyakan bisnis yang ingin ditemukan menjawab tidak, ya, ya."),
        b("Open the robots.txt editor in your SEO plugin (Yoast SEO: Tools, File editor. Rank Math: General Settings, Edit robots.txt).", "Buka editor robots.txt di plugin SEO Anda (Yoast SEO: Tools, File editor. Rank Math: General Settings, Edit robots.txt)."),
        b("Add this line at the top, with your own answers: Content-Signal: ai-train=no, search=yes, ai-input=yes. Save.", "Tambahkan baris ini di bagian atas, dengan jawaban Anda sendiri: Content-Signal: ai-train=no, search=yes, ai-input=yes. Simpan."),
      ],
      shopify: [
        b("Decide your three answers first: may AI train on your content, may it appear in AI search, and may AI use it to answer customers. Most businesses that want to be found say no, yes, yes.", "Putuskan dulu tiga jawaban Anda: bolehkah AI melatih diri dengan konten Anda, bolehkah muncul di pencarian AI, dan bolehkah AI memakainya untuk menjawab pelanggan. Kebanyakan bisnis yang ingin ditemukan menjawab tidak, ya, ya."),
        b("In Shopify this line goes into a special theme file, so give your three answers to your developer or an AI coding assistant with the prompt below.", "Di Shopify baris ini dimasukkan ke berkas tema khusus, jadi berikan tiga jawaban Anda ke developer atau asisten AI untuk coding bersama prompt di bawah."),
      ],
    },
  },

  link_headers: devBonus(b(
    "It gives AI assistants shortcuts to your most useful pages as soon as they arrive.",
    "Ini memberi asisten AI jalan pintas ke halaman Anda yang paling berguna begitu mereka tiba."
  )),
  mcp_server_card: devBonus(b(
    "It is a description of the actions an AI assistant can take on your website, such as ordering. It only matters if you want AI assistants to act for your customers.",
    "Ini deskripsi tindakan yang bisa dilakukan asisten AI di website Anda, seperti memesan. Hanya penting kalau Anda ingin asisten AI bertindak untuk pelanggan."
  )),
  agent_skills_index: devBonus(b(
    "It is a list of things an AI assistant can do on your website. It only matters if you offer actions such as ordering or booking.",
    "Ini daftar hal yang bisa dilakukan asisten AI di website Anda. Hanya penting kalau Anda menawarkan tindakan seperti memesan atau reservasi."
  )),
  ard_manifest: devBonus(b(
    "It is a catalogue that lets AI tools find the services your business offers. It is new and optional.",
    "Ini katalog yang memungkinkan alat AI menemukan layanan yang ditawarkan bisnis Anda. Masih baru dan tidak wajib."
  )),
  auth_md: devBonus(b(
    "It explains how an AI assistant can sign in on behalf of a customer. It only matters if your website has customer accounts.",
    "Ini menjelaskan cara asisten AI masuk atas nama pelanggan. Hanya penting kalau website Anda punya akun pelanggan."
  )),
  oauth_discovery: devBonus(b(
    "It tells AI tools how sign-in works on your website. It only matters if your website has customer accounts.",
    "Ini memberi tahu alat AI bagaimana cara masuk di website Anda. Hanya penting kalau website Anda punya akun pelanggan."
  )),
  oauth_protected_resource: devBonus(b(
    "It tells AI tools which parts of your website need a sign-in. It only matters if your website has customer accounts.",
    "Ini memberi tahu alat AI bagian website mana yang butuh login. Hanya penting kalau website Anda punya akun pelanggan."
  )),
}
