import MapView, { Marker } from "react-native-maps";
import { View } from "react-native";

export default function App() {
  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={{
          latitude: 44.2312,
          longitude: -76.4860,
          latitudeDelta: 0.2,
          longitudeDelta: 0.2,
        }}
      >
        <Marker coordinate={{ latitude: 44.2312, longitude: -76.4860 }} />
      </MapView>
    </View>
  );
}
