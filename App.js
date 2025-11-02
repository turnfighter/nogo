import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, Image, StyleSheet, Platform, KeyboardAvoidingView } from "react-native";
import MapView, { Marker, Polyline, Circle } from "react-native-maps";
import * as Location from "expo-location";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

/* ---- helpers (unchanged) ---- */
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const haversine = (a, b) => {
  const R = 6371e3;
  const φ1 = toRad(a.latitude), λ1 = toRad(a.longitude);
  const φ2 = toRad(b.latitude), λ2 = toRad(b.longitude);
  const dφ = φ2 - φ1, dλ = λ2 - λ1;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 5000 ? 1 : 0)} km`);
const fmtMins = (min) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} hr ${Math.round(min % 60) || ""}`.trim());
const destPoint = (lat, lon, distanceMeters, bearingRad) => {
  const R = 6371e3;
  const φ1 = toRad(lat), λ1 = toRad(lon);
  const δ = distanceMeters / R, θ = bearingRad;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { latitude: toDeg(φ2), longitude: ((toDeg(λ2) + 540) % 360) - 180 };
};

const funnyProfiles = [
  { name: "Alex", quote: "Just moved to the neighborhood — come say hi 👋" },
  { name: "Jordan", quote: "Looking for someone to explore nearby spots with 🗺️" },
  { name: "Taylor", quote: "You’ll never guess where I am 😏" },
  { name: "Sam", quote: "Says they know a shortcut... don’t trust them 😈" },
  { name: "Riley", quote: "Apparently only 2 km away. Suspicious 🤔" },
];

const modeEmoji = { car: "🚗", walk: "🚶", bus: "🚌", train: "🚆" };
const osrmProfileFor = (mode) => (mode === "walk" ? "foot" : "driving");

/* ---- API calls ---- */
async function photonSearch(q, bias) {
  if (!q) return [];
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lat=${bias.latitude}&lon=${bias.longitude}&lang=en`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const name = [p.name, p.street, p.housenumber, p.city || p.town || p.village, p.state, p.country].filter(Boolean);
    const title = [...new Set(name)].join(", ") || p.type || "Unnamed place";
    return { title, coords: { latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0] }, type: p.type || "POI" };
  });
}
async function osrmNearest(latlng, mode) {
  const prof = osrmProfileFor(mode);
  const url = `https://router.project-osrm.org/nearest/v1/${prof}/${latlng.longitude},${latlng.latitude}?number=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("nearest failed");
  const data = await res.json();
  const wp = data?.waypoints?.[0];
  if (!wp?.location) throw new Error("no waypoint");
  const [lng, lat] = wp.location;
  return { latitude: lat, longitude: lng };
}
async function osrmRoute(start, end, mode) {
  const prof = osrmProfileFor(mode);
  const url = `https://router.project-osrm.org/route/v1/${prof}/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("route failed");
  const data = await res.json();
  const r = data?.routes?.[0];
  if (!r) throw new Error("no route");
  const coords = r.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  return { coords, distance: r.distance, duration: r.duration };
}

/* ---- Inner app uses safe-area ---- */
function InnerApp() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);

  const [region, setRegion] = useState({ latitude: 43.6532, longitude: -79.3832, latitudeDelta: 0.2, longitudeDelta: 0.2 });
  const [me, setMe] = useState(null);
  const [accuracy, setAccuracy] = useState(30);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [mode, setMode] = useState("car");

  const [target, setTarget] = useState(null);
  const [route, setRoute] = useState(null);
  const [showCard, setShowCard] = useState(false);
  const randomProfile = useMemo(() => funnyProfiles[Math.floor(Math.random() * funnyProfiles.length)], [showCard]);

  /* location */
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setMe(here);
      setAccuracy(pos.coords.accuracy || 30);
      setRegion((r) => ({ ...r, ...here, latitudeDelta: 0.08, longitudeDelta: 0.08 }));
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 2000, distanceInterval: 2 },
        (p) => {
          setMe({ latitude: p.coords.latitude, longitude: p.coords.longitude });
          setAccuracy(p.coords.accuracy || 30);
        }
      );
    })();
  }, []);

  /* search */
  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      try {
        const bias = me || { latitude: region.latitude, longitude: region.longitude };
        const feats = await photonSearch(query.trim(), bias);
        if (!active) return;
        feats.sort((a, b) => haversine(bias, a.coords) - haversine(bias, b.coords) < 0 ? -1 : 1);
        setResults(feats);
        setShowResults(true);
      } catch { }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [query, me, region.latitude, region.longitude]);

  const pickFakeRoutableTarget = async (center, tries = 6) => {
    for (let i = 0; i < tries; i++) {
      const distKm = (5 * (0.3 + 0.7 * Math.random()));
      const bearing = Math.random() * 2 * Math.PI;
      const c = destPoint(center.latitude, center.longitude, distKm * 1000, bearing);
      try {
        const snapped = await osrmNearest(c, mode);
        if (haversine(center, snapped) > 200) return snapped;
      } catch { }
    }
    throw new Error("no routable target");
  };

  const estimateTransitMinutes = (distanceMeters, m) => {
    const dKm = distanceMeters / 1000;
    const speeds = { bus: 22, train: 80 };
    const wait = { bus: 3 + Math.random() * 7, train: 5 + Math.random() * 15 };
    const move = (dKm / speeds[m]) * 60;
    return move + wait[m];
  };

  const routeToFake = async () => {
    const start = me || { latitude: region.latitude, longitude: region.longitude };
    try {
      const fake = await pickFakeRoutableTarget(start, 6);
      const r = await osrmRoute(start, fake, mode);
      const mins = (mode === "bus" || mode === "train") ? estimateTransitMinutes(r.distance, mode) : r.duration / 60;
      setTarget(fake);
      setRoute({ coords: r.coords, distance: r.distance, minutes: mins });
      mapRef.current?.fitToCoordinates(r.coords, { edgePadding: { top: 100, bottom: 120, left: 60, right: 60 }, animated: true });
    } catch {
      alert("Couldn’t find a nearby road for the fake target. Try again.");
    }
  };

  const selectResult = (item) => {
    setQuery(item.title);
    setShowResults(false);
    setShowCard(true);
    mapRef.current?.animateToRegion({ ...item.coords, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 300);
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={region}
        onRegionChangeComplete={setRegion}
      >
        {me && (
          <>
            <Marker coordinate={me} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.blueDotOuter}><View style={styles.blueDotInner} /></View>
            </Marker>
            <Circle center={me} radius={Math.max(accuracy, 10)} strokeWidth={1} strokeColor="rgba(26,115,232,0.2)" fillColor="rgba(26,115,232,0.08)" />
          </>
        )}
        {target && <Marker coordinate={target} pinColor="#ff4da6" />}
        {route?.coords?.length ? (
          <>
            <Polyline coordinates={route.coords} strokeWidth={7} strokeColor="#ffd1e8" />
            <Polyline coordinates={route.coords} strokeWidth={4} strokeColor="#ff4da6" />
          </>
        ) : null}
      </MapView>

      {/* Top controls inside safe-area + keyboard avoid */}
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={[styles.controlsWrap, { paddingTop: insets.top + 8 }]}>
        <View style={styles.controls}>
          <View style={styles.searchWrap}>
            <TextInput
              value={query}
              onChangeText={(t) => { setQuery(t); setShowResults(true); }}
              placeholder="Search for a place..."
              style={styles.input}
              returnKeyType="search"
              autoCorrect={false}
            />
            {showResults && !!results.length && (
              <View style={styles.resultsBox}>
                <FlatList
                  keyboardShouldPersistTaps="handled"
                  data={results}
                  keyExtractor={(_, i) => String(i)}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.resultRow} onPress={() => selectResult(item)}>
                      <View style={styles.pin} />
                      <View style={{ flexShrink: 1 }}>
                        <Text numberOfLines={1} style={styles.rMain}>{item.title}</Text>
                        <Text numberOfLines={1} style={styles.rSub}>{item.type || "POI"}</Text>
                      </View>
                      <Text style={styles.rDist}>{me ? fmtDist(haversine(me, item.coords)) : ""}</Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
          </View>

          <View style={styles.modes}>
            {["car", "walk", "bus", "train"].map((m) => (
              <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.mode, mode === m && styles.modeActive]}>
                <Text style={{ fontSize: 16 }}>{modeEmoji[m]}</Text>
                <Text style={styles.modeLabel}>{m[0].toUpperCase() + m.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.go} onPress={routeToFake}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Go</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Funny profile card (responsive width) */}
      {showCard && (
        <View style={[styles.card, { top: insets.top + 80, width: "84%", maxWidth: 360 }]}>
          <Image source={{ uri: `https://source.unsplash.com/600x400/?portrait,person,smile&sig=${Math.random()}` }} style={{ width: "100%", height: 180 }} resizeMode="cover" />
          <View style={{ padding: 12 }}>
            <Text style={{ fontWeight: "700", fontSize: 16 }}>{randomProfile.name}, {Math.floor(Math.random() * 5) + 1} km away 😎</Text>
            <Text style={{ color: "#555", marginTop: 4 }}>"{randomProfile.quote}"</Text>
          </View>
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#eee", padding: 12, alignItems: "center" }}>
            <TouchableOpacity style={styles.cardBtn} onPress={() => { setShowCard(false); routeToFake(); }}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Get Directions 😈</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.cardClose} onPress={() => setShowCard(false)}>
            <Text style={{ fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* HUD above home indicator */}
      {route && (
        <View style={[styles.hud, { bottom: insets.bottom + 12 }]}>
          <Text style={{ color: "#fff" }}>
            {modeEmoji[mode]} {mode.toUpperCase()} • <Text style={{ fontWeight: "700" }}>{fmtDist(route.distance)}</Text> • ~<Text style={{ fontWeight: "700" }}>{fmtMins(route.minutes)}</Text>
          </Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <InnerApp />
    </SafeAreaProvider>
  );
}

/* ---- styles ---- */
const styles = StyleSheet.create({
  controlsWrap: { position: "absolute", left: 0, right: 0 },
  controls: {
    marginHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.92)", padding: 8, borderRadius: 12,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, elevation: 4
  },
  searchWrap: { flex: 1, position: "relative" },
  input: { height: 42, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(0,0,0,0.2)", backgroundColor: "#fff" },
  resultsBox: {
    position: "absolute", top: 46, left: 0, right: 0, maxHeight: 280, backgroundColor: "#fff",
    borderWidth: 1, borderColor: "rgba(0,0,0,0.2)", borderRadius: 10, overflow: "hidden"
  },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  pin: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#ff4da6", opacity: 0.9 },
  rMain: { fontWeight: "700", fontSize: 13 },
  rSub: { fontSize: 12, color: "#555" },
  rDist: { marginLeft: "auto", fontSize: 12, color: "#111" },
  modes: { flexDirection: "row", gap: 6, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(0,0,0,0.15)", borderRadius: 10, padding: 4 },
  mode: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: "transparent" },
  modeActive: { backgroundColor: "#f7f7f9", borderColor: "rgba(0,0,0,0.15)" },
  modeLabel: { fontSize: 13 },
  go: { backgroundColor: "#ff4da6", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  blueDotOuter: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  blueDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#1a73e8" },
  card: {
    position: "absolute", left: "8%", backgroundColor: "#fff", borderRadius: 14,
    overflow: "hidden", elevation: 6, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12
  },
  cardBtn: { backgroundColor: "#ff4da6", paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10 },
  cardClose: {
    position: "absolute", top: 8, right: 10, backgroundColor: "rgba(255,255,255,0.9)", width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4
  },
  hud: {
    position: "absolute", alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.85)", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10
  },
});
