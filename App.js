import React, { useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView, View, Text, TextInput, FlatList, Pressable, Image, StyleSheet, Platform, Keyboard, Dimensions } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";

const firstNames = ['Avery', 'Jordan', 'Riley', 'Taylor', 'Morgan', 'Elliot', 'Rowan', 'Charlie', 'Reese', 'Skyler', 'Alex', 'Quinn', 'Peyton', 'Dakota', 'Casey', 'Remy', 'Jamie', 'Harper', 'Sage', 'Kai'];
const lastNames = ['Hart', 'Rivera', 'Quinn', 'Stone', 'Bennett', 'Sutton', 'Hayes', 'Reid', 'Brooks', 'Cole', 'Ramos', 'Blake', 'Parker', 'Lane', 'Ellis', 'Greer', 'Monroe', 'Jensen', 'Shaw', 'Wells'];
const taglines = [
  '“Will swipe right for tacos 🌮.”', '“Left turns only, sorry.”', '“Scenic route > fastest route.”',
  '“Professional third-wheeler.”', '“Here for wrong directions & right vibes.”',
  '“Dog person. Also maps person.”', '“Let’s get lost (locally).”', '“5⭐ date, 2⭐ navigator.”'
];
const rp = a => a[Math.floor(Math.random() * a.length)];
const rName = () => `${rp(firstNames)} ${rp(lastNames)}`;
const rAge = () => Math.floor(18 + Math.random() * 21);

const ModePill = ({ label, emoji, active, onPress }) => (
  <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]} hitSlop={8}>
    <Text style={styles.pillEmoji}>{emoji}</Text>
    <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
  </Pressable>
);

export default function App() {
  // --- Map & location ---
  const [region, setRegion] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        // Fallback to Toronto
        setRegion({ latitude: 43.6532, longitude: -79.3832, latitudeDelta: 0.05, longitudeDelta: 0.05 });
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      });
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (pos) => setRegion(r => ({ ...r, latitude: pos.coords.latitude, longitude: pos.coords.longitude }))
      );
    })();
  }, []);

  // --- Search / autocomplete (Photon/OSM) ---
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) { setResults([]); setShowResults(false); return; }
      try {
        const lat = region?.latitude ?? 43.6532;
        const lon = region?.longitude ?? -79.3832;
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=10&lat=${lat}&lon=${lon}&lang=en`;
        const r = await fetch(url);
        const j = await r.json();
        const items = (j.features || []).map(f => {
          const p = f.properties || {};
          const nameParts = [p.name, p.street, p.housenumber, p.city || p.town || p.village, p.state, p.country].filter(Boolean);
          const name = [...new Set(nameParts)].join(", ") || p.osm_value || "Unnamed place";
          const [x, y] = f.geometry.coordinates;
          return { id: `${x},${y}`, name, type: p.type || "POI", lat: y, lon: x };
        });
        setResults(items);
        setShowResults(true);
      } catch {
        setResults([]); setShowResults(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, region]);

  const onPickResult = (item) => {
    setQuery(item.name);
    setShowResults(false);
    Keyboard.dismiss();
    // Pan map to selection
    mapRef.current?.animateToRegion({ latitude: item.lat, longitude: item.lon, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
  };

  // --- Modes ---
  const [mode, setMode] = useState("car"); // car | walk | bus | train

  // --- Hot Singles card ---
  const [profile, setProfile] = useState({ name: rName(), age: rAge(), distanceKm: "–", tagline: "Refreshing your fated match…", photo: null });

  const loadPortrait = async () => {
    try {
      const r = await fetch("https://randomuser.me/api/?inc=picture&noinfo", { cache: "no-store" });
      const j = await r.json();
      const url = j?.results?.[0]?.picture?.large || j?.results?.[0]?.picture?.medium;
      if (url) {
        setProfile(p => ({ ...p, photo: url, tagline: rp(taglines) }));
        return;
      }
    } catch { }
    // fallback
    const id = Math.floor(1 + Math.random() * 70);
    setProfile(p => ({ ...p, photo: `https://i.pravatar.cc/512?img=${id}`, tagline: rp(taglines) }));
  };

  const refreshMatch = () => {
    const name = rName(); const age = rAge();
    const distanceKm = region ? (Math.random() * 4 + 0.3).toFixed(1) : "–";
    setProfile({ name, age, distanceKm, tagline: "Choosing your most photogenic match…", photo: null });
    loadPortrait();
  };

  useEffect(() => { refreshMatch(); }, []);

  const goRandom = () => {
    // For now: just nudge camera a bit to simulate a “date spot lock”
    if (!region) return;
    const bearing = Math.random() * Math.PI * 2;
    const dLat = 0.01 * Math.cos(bearing);
    const dLon = 0.01 * Math.sin(bearing);
    const dest = { latitude: region.latitude + dLat, longitude: region.longitude + dLon, latitudeDelta: 0.02, longitudeDelta: 0.02 };
    mapRef.current?.animateToRegion(dest, 600);
  };

  const windowW = Dimensions.get("window").width;
  const isSmall = windowW < 380;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.mapWrap}>
        {region && (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_GOOGLE}
            showsUserLocation
            initialRegion={region}
            onRegionChangeComplete={setRegion}
          >
            {/* Optional: drop a marker when user picks a result */}
            {/* <Marker coordinate={{ latitude: ..., longitude: ... }} /> */}
          </MapView>
        )}

        {/* Top controls */}
        <View style={styles.controls} pointerEvents="box-none">
          {/* Search */}
          <View style={[styles.searchWrap, { width: isSmall ? 260 : 320 }]}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search for a place..."
              placeholderTextColor="#7a7a7a"
              style={styles.search}
              onFocus={() => setShowResults(true)}
            />
            {showResults && !!results.length && (
              <View style={styles.results}>
                <FlatList
                  keyboardShouldPersistTaps="handled"
                  data={results}
                  keyExtractor={(it) => it.id}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => onPickResult(item)} style={styles.resultRow}>
                      <View style={styles.pin} />
                      <View style={{ flexShrink: 1 }}>
                        <Text numberOfLines={1} style={styles.rMain}>{item.name}</Text>
                        <Text numberOfLines={1} style={styles.rSub}>{item.type}</Text>
                      </View>
                    </Pressable>
                  )}
                />
              </View>
            )}
          </View>

          {/* Modes */}
          <View style={styles.modeBar}>
            <ModePill label="Car" emoji="🚗" active={mode === "car"} onPress={() => setMode("car")} />
            <ModePill label="Walk" emoji="🚶" active={mode === "walk"} onPress={() => setMode("walk")} />
            <ModePill label="Bus" emoji="🚌" active={mode === "bus"} onPress={() => setMode("bus")} />
            <ModePill label="Train" emoji="🚆" active={mode === "train"} onPress={() => setMode("train")} />
          </View>

          {/* Go button */}
          <Pressable style={styles.goBtn} onPress={goRandom}>
            <Text style={styles.goText}>Go</Text>
          </Pressable>
        </View>

        {/* Hot Singles Card */}
        <View style={styles.card} pointerEvents="box-none">
          <View style={styles.cardInner}>
            <Text style={styles.cardHeader}>🔥 Hot singles in your area</Text>
            <Image source={profile.photo ? { uri: profile.photo } : null} style={styles.face} resizeMode="cover" />
            <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
              <View style={styles.row}>
                <Text style={styles.name}>{profile.name}</Text>
                <Text style={styles.pill}>{profile.age}</Text>
                <Text style={styles.pill}>{profile.distanceKm} km away</Text>
              </View>
              <Text style={styles.sub} numberOfLines={2}>{profile.tagline}</Text>
              <View style={styles.actions}>
                <Pressable style={[styles.btn, styles.btnGhost]} onPress={refreshMatch}>
                  <Text style={styles.btnGhostText}>New match</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnPrimary]} onPress={goRandom}>
                  <Text style={styles.btnPrimaryText}>Get directions</Text>
                </Pressable>
              </View>
              <Text style={styles.powered}>Photos from randomuser.me / pravatar.cc</Text>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  mapWrap: { flex: 1 },

  // --- Controls ---
  controls: {
    position: "absolute", top: 8, left: 0, right: 0, alignItems: "center", zIndex: 20,
  },
  searchWrap: {
    position: "relative",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(0,0,0,0.12)",
    ...Platform.select({ android: { elevation: 3 }, ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } } })
  },
  search: {
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#111", width: "100%",
    borderRadius: 12,
  },
  results: {
    position: "absolute", top: 46, left: -1, right: -1, maxHeight: 280,
    backgroundColor: "#fff",
    borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
    borderWidth: 1, borderColor: "rgba(0,0,0,0.12)",
    overflow: "hidden",
  },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  pin: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#ff4da6" },
  rMain: { fontWeight: "700", fontSize: 13, color: "#111" },
  rSub: { fontSize: 12, color: "#666" },

  modeBar: {
    flexDirection: "row", marginTop: 8, backgroundColor: "#fff", padding: 4, borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(0,0,0,0.12)",
  },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, borderWidth: 1, borderColor: "transparent",
  },
  pillActive: { backgroundColor: "#f7f7f9", borderColor: "rgba(0,0,0,0.15)" },
  pillEmoji: { fontSize: 16 },
  pillText: { fontSize: 13, color: "#222", fontWeight: "600" },
  pillTextActive: { color: "#000" },

  goBtn: {
    marginTop: 8, backgroundColor: "#ff4da6", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
    ...Platform.select({ android: { elevation: 2 }, ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } } })
  },
  goText: { color: "#111", fontWeight: "800", letterSpacing: 0.2 },

  // --- Card ---
  card: { position: "absolute", right: 16, bottom: 16, zIndex: 15, maxWidth: 360 },
  cardInner: {
    backgroundColor: "#111", borderRadius: 16, overflow: "hidden",
    ...Platform.select({ android: { elevation: 8 }, ios: { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } } })
  },
  cardHeader: {
    color: "#fff", fontWeight: "800", fontSize: 15, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: "#111",
    // gradient-like strip
  },
  face: { width: "100%", height: 180, backgroundColor: "#222" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  name: { color: "#fff", fontSize: 18, fontWeight: "800", flexShrink: 1 },
  pill: { color: "#fff", backgroundColor: "#1f1f1f", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontSize: 12 },
  sub: { color: "#cfcfcf", fontSize: 13, marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: "#232323" },
  btnGhostText: { color: "#fff", fontWeight: "800" },
  btnPrimary: { backgroundColor: "#ff4da6" },
  btnPrimaryText: { color: "#111", fontWeight: "900" },
  powered: { color: "#9a9a9a", fontSize: 11, textAlign: "center", marginTop: 8, marginBottom: 4 },
});
