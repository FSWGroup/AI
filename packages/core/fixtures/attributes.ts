/** Attribute definitions: core + category-specific. criticality drives the answer gate's evidence requirements. */
export interface AttributeDef {
  key: string;
  label: string;
  dataType: "number" | "text" | "boolean" | "enum" | "range";
  unit?: string;
  scope: string;
  criticality: 1 | 2 | 3 | 4 | 5;
  allowedValues?: string[];
}

export const ATTRIBUTE_DEFINITIONS: AttributeDef[] = [
  // core
  { key: "product_type", label: "Product type", dataType: "enum", scope: "core", criticality: 2,
    allowedValues: ["ball_valve","butterfly_valve","gate_valve","globe_valve","check_valve","steam_trap","pneumatic_actuator","electric_actuator","solenoid_valve","limit_switch","mounting_kit","filter_regulator"] },
  { key: "size_in", label: "Nominal size", dataType: "number", unit: "in", scope: "core", criticality: 3 },
  { key: "end_connection", label: "End connection", dataType: "enum", scope: "core", criticality: 3,
    allowedValues: ["NPT","socket_weld","butt_weld","flanged_150","flanged_300","wafer","lug","tri_clamp","BSPP","BSPT","threaded_female"] },
  { key: "body_material", label: "Body material", dataType: "text", scope: "core", criticality: 4 },
  { key: "pressure_rating_psi", label: "Pressure rating", dataType: "number", unit: "psi", scope: "core", criticality: 4 },
  { key: "temp_min_f", label: "Minimum temperature", dataType: "number", unit: "F", scope: "core", criticality: 4 },
  { key: "temp_max_f", label: "Maximum temperature", dataType: "number", unit: "F", scope: "core", criticality: 4 },
  { key: "weight_lb", label: "Weight", dataType: "number", unit: "lb", scope: "core", criticality: 1 },
  { key: "certifications", label: "Certifications", dataType: "text", scope: "core", criticality: 3 },
  { key: "lead_free", label: "Lead-free compliant", dataType: "boolean", scope: "core", criticality: 3 },
  { key: "media", label: "Rated media", dataType: "text", scope: "core", criticality: 4 },
  // valve-specific
  { key: "ball_material", label: "Ball material", dataType: "text", scope: "ball_valve", criticality: 3 },
  { key: "disc_material", label: "Disc material", dataType: "text", scope: "butterfly_valve", criticality: 3 },
  { key: "seat_material", label: "Seat material", dataType: "text", scope: "valve", criticality: 4 },
  { key: "stem_material", label: "Stem material", dataType: "text", scope: "valve", criticality: 2 },
  { key: "seal_material", label: "Seal material", dataType: "text", scope: "valve", criticality: 3 },
  { key: "port_configuration", label: "Port configuration", dataType: "enum", scope: "valve", criticality: 2, allowedValues: ["full_port","standard_port","reduced_port","2_way","3_way"] },
  { key: "steam_rating_psi", label: "Steam rating", dataType: "number", unit: "psi", scope: "valve", criticality: 4 },
  { key: "cv", label: "Cv", dataType: "number", scope: "valve", criticality: 4 },
  { key: "flow_characteristic", label: "Flow characteristic", dataType: "text", scope: "valve", criticality: 2 },
  { key: "break_torque_inlb", label: "Break (seating) torque", dataType: "number", unit: "in-lb", scope: "valve", criticality: 4 },
  { key: "mount_pad_iso5211", label: "ISO 5211 mounting pad", dataType: "text", scope: "valve", criticality: 4 },
  { key: "stem_size_mm", label: "Stem size", dataType: "number", unit: "mm", scope: "valve", criticality: 4 },
  { key: "vacuum_rating", label: "Vacuum rating", dataType: "text", scope: "valve", criticality: 3 },
  // actuator-specific
  { key: "actuation", label: "Actuation", dataType: "enum", scope: "actuator", criticality: 3, allowedValues: ["double_acting","spring_return","electric_on_off","electric_modulating","manual"] },
  { key: "torque_output_inlb_80psi", label: "Output torque @ 80 psi", dataType: "number", unit: "in-lb", scope: "actuator", criticality: 4 },
  { key: "spring_end_torque_inlb", label: "Spring end torque", dataType: "number", unit: "in-lb", scope: "actuator", criticality: 4 },
  { key: "air_start_torque_inlb_80psi", label: "Air stroke start torque @ 80 psi", dataType: "number", unit: "in-lb", scope: "actuator", criticality: 4 },
  { key: "supply_pressure_min_psi", label: "Minimum supply pressure", dataType: "number", unit: "psi", scope: "actuator", criticality: 4 },
  { key: "supply_pressure_max_psi", label: "Maximum supply pressure", dataType: "number", unit: "psi", scope: "actuator", criticality: 4 },
  { key: "actuator_mount_iso5211", label: "ISO 5211 mounting", dataType: "text", scope: "actuator", criticality: 4 },
  { key: "actuator_drive_mm", label: "Female drive size", dataType: "number", unit: "mm", scope: "actuator", criticality: 4 },
  // electrical
  { key: "voltage", label: "Voltage", dataType: "text", scope: "electrical", criticality: 3 },
  { key: "enclosure_rating", label: "Enclosure rating", dataType: "text", scope: "electrical", criticality: 3 },
  { key: "hazardous_area_cert", label: "Hazardous area certification", dataType: "text", scope: "electrical", criticality: 4 },
];
