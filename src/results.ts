// Results section data. Images: public/img/results/aligned/{set}_{method}.webp (scripts/align_results.py);
// Q-MDF sets also have {set}_{method}_patch.webp for ours and the baselines (manifold patches coloured).
// Numbers: UDF benchmarks from the paper Fig. 13-15 (CD ×10⁻³); the other groups from the supplementary
// material: Fig. 3 (sharp edges, #V), Fig. 2 (non-manifold, #V), Fig. 5-6 (Q-MDF, Euler characteristic χ).

export interface Method { id: string, name: string, stat?: string }
/** `res`: grid resolution the baselines extracted their meshes at (ours is grid-free) */
export interface Dataset { id: string, name: string, res: string, ours: string, methods: Method[], note: string, patches?: boolean }
export interface Group { id: string, name: string, subgroups: { name: string, sets: Dataset[] }[] }

const SHARP_NOTE = 'Sharp edges (45° dihedral angle) highlighted; baselines at 128³. #V: number of vertices.'
const NM_NOTE = 'Two CAD parts intersected into one non-manifold shape; non-manifold edges highlighted. Ours queries the distance to the triangle soup directly (the neural-UDF variant is in the thumbnails); baselines at 128³.'
const QMDF_NOTE = 'Learned quasi-medial distance field (Q-MDF); baselines at 256³. <b>Patches</b> colours the manifold patches of each mesh, with non-manifold edges highlighted. χ: Euler characteristic.'

const UDF_SETS: Dataset[] = [
  {
    id: 'copyroom', name: '3DScene', res: '256³', ours: '#V 46.6K · CD 2.21',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'Copyroom' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 241.2K · CD 1.96' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 247.9K · CD 1.88' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 199.9K · CD 3.77' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 167.6K · CD 1.84' },
      { id: 'mind', name: 'MIND', stat: '#V 119.8K · CD 3.16' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 286.9K · CD 2.74' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 447.9K · CD 2.22' },
    ],
    note: 'A scanned room, baselines at 256³: a similar Chamfer distance (×10⁻³) with <b>3 to 10× fewer vertices</b>.',
  },
  {
    id: 'car', name: 'ShapeNetCar', res: '256³', ours: '#V 17.4K · CD 1.52',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'ShapeNetCar' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 201.3K · CD 2.11' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 228.1K · CD 2.21' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 164.7K · CD 2.33' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 140.5K · CD 1.95' },
      { id: 'mind', name: 'MIND', stat: '#V 101.3K · CD 1.68' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 302.3K · CD 1.91' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 434.3K · CD 1.90' },
    ],
    note: 'A car with its interior, baselines at 256³: <b>the best Chamfer distance</b> with 6 to 25× fewer vertices.',
  },
  {
    id: 'garment', name: 'DeepFashion', res: '128³', ours: '#V 15.2K · CD 2.13',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'DeepFashion 18-9' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 49.9K · CD 2.87' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 56.2K · CD 1.80' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 45.4K · CD 4.08' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 33.5K · CD 2.75' },
      { id: 'mind', name: 'MIND', stat: '#V 26.5K · CD 3.16' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 79.7K · CD 2.79' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 92.7K · CD 2.55' },
    ],
    note: 'An open garment, baselines at 128³: comparable accuracy with the most compact mesh.',
  },
]

const SHARP_SETS: Dataset[] = [
  {
    id: 'sharp_020', name: 'ABC_020', res: '128³', ours: '#V 13.9K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'ABC_020 · #V 20.7K' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 52.3K' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 68.9K' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 29.2K' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 23.1K' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 27.1K' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 34.7K' },
      { id: 'mind', name: 'MIND', stat: '#V 16.5K' },
    ],
    note: SHARP_NOTE,
  },
  {
    id: 'sharp_14859', name: 'ABC_14859', res: '128³', ours: '#V 10.8K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'ABC_14859 · #V 9.1K' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 21.1K' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 25.0K' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 20.2K' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 17.5K' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 18.6K' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 30.4K' },
      { id: 'mind', name: 'MIND', stat: '#V 10.6K' },
    ],
    note: SHARP_NOTE,
  },
  {
    id: 'sharp_168', name: 'ABC_168', res: '128³', ours: '#V 34.3K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'ABC_168 · #V 22.2K' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 55.9K' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 60.9K' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 57.1K' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 51.1K' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 53.6K' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 83.1K' },
      { id: 'mind', name: 'MIND', stat: '#V 32.5K' },
    ],
    note: SHARP_NOTE,
  },
  {
    id: 'sharp_275', name: 'ABC_275', res: '128³', ours: '#V 48.1K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'ABC_275 · #V 27.1K' },
      { id: 'dcudf', name: 'DCUDF', stat: '#V 93.0K' },
      { id: 'dcudf2', name: 'DCUDF2', stat: '#V 105.6K' },
      { id: 'capudf', name: 'CAP-UDF', stat: '#V 97.0K' },
      { id: 'geoudf', name: 'GeoUDF', stat: '#V 83.9K' },
      { id: 'meshudf', name: 'MeshUDF', stat: '#V 94.2K' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 117.1K' },
      { id: 'mind', name: 'MIND', stat: '#V 55.0K' },
    ],
    note: SHARP_NOTE,
  },
]

const NM_SETS: Dataset[] = [
  {
    id: 'nm_007', name: 'nmabc_007', res: '128³', ours: 'triangle soup · #V 13.7K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'intersected ABC' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 65.1K' },
      { id: 'mind', name: 'MIND', stat: '#V 33.6K' },
      { id: 'ours_udf', name: 'Ours · neural UDF', stat: 'grid-free · #V 12.4K' },
    ],
    note: NM_NOTE,
  },
  {
    id: 'nm_032', name: 'nmabc_032', res: '128³', ours: 'triangle soup · #V 18.2K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'intersected ABC' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 109.2K' },
      { id: 'mind', name: 'MIND', stat: '#V 62.8K' },
      { id: 'ours_udf', name: 'Ours · neural UDF', stat: 'grid-free · #V 19.2K' },
    ],
    note: NM_NOTE,
  },
  {
    id: 'nm_038', name: 'nmabc_038', res: '128³', ours: 'triangle soup · #V 22.3K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'intersected ABC' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 132.2K' },
      { id: 'mind', name: 'MIND', stat: '#V 73.1K' },
      { id: 'ours_udf', name: 'Ours · neural UDF', stat: 'grid-free · #V 21.4K' },
    ],
    note: NM_NOTE,
  },
  {
    id: 'nm_049', name: 'nmabc_049', res: '128³', ours: 'triangle soup · #V 19.2K',
    methods: [
      { id: 'gt', name: 'Ground truth', stat: 'intersected ABC' },
      { id: 'dualmesh', name: 'DualMesh-UDF', stat: '#V 115.0K' },
      { id: 'mind', name: 'MIND', stat: '#V 67.4K' },
      { id: 'ours_udf', name: 'Ours · neural UDF', stat: 'grid-free · #V 21.1K' },
    ],
    note: NM_NOTE,
  },
]

const QMDF_ORGANIC: Dataset[] = [
  {
    id: 'qmdf_fertility', name: 'Fertility', res: '256³', ours: 'χ = −3', patches: true,
    methods: [
      { id: 'gt', name: 'Input mesh', stat: 'χ = −6' },
      { id: 'dcudf', name: 'DCUDF', stat: 'χ = −6' },
      { id: 'mind', name: 'MIND', stat: 'χ = −103' },
    ],
    note: QMDF_NOTE,
  },
  {
    id: 'qmdf_teapot', name: 'Teapot', res: '256³', ours: 'χ = −4', patches: true,
    methods: [
      { id: 'gt', name: 'Input mesh', stat: 'χ = −8' },
      { id: 'dcudf', name: 'DCUDF', stat: 'χ = −8' },
      { id: 'mind', name: 'MIND', stat: 'χ = −15' },
    ],
    note: QMDF_NOTE,
  },
  {
    id: 'qmdf_bunny', name: 'Bunny', res: '256³', ours: 'χ = 1', patches: true,
    methods: [
      { id: 'gt', name: 'Input mesh', stat: 'χ = 2' },
      { id: 'dcudf', name: 'DCUDF', stat: 'χ = −18' },
      { id: 'mind', name: 'MIND', stat: 'χ = −78' },
    ],
    note: QMDF_NOTE,
  },
]

const QMDF_CAD: Dataset[] = [
  {
    id: 'qmdf_abc020', name: 'ABC_020', res: '256³', ours: 'χ = −1', patches: true,
    methods: [
      { id: 'gt', name: 'Input mesh', stat: 'χ = −2' },
      { id: 'dcudf', name: 'DCUDF', stat: 'χ = −2' },
      { id: 'mind', name: 'MIND', stat: 'χ = 6' },
    ],
    note: QMDF_NOTE,
  },
  {
    id: 'qmdf_abc003', name: 'ABC_003', res: '256³', ours: 'χ = 1', patches: true,
    methods: [
      { id: 'gt', name: 'Input mesh', stat: 'χ = 2' },
      { id: 'dcudf', name: 'DCUDF', stat: 'χ = 2' },
      { id: 'mind', name: 'MIND', stat: 'χ = −4' },
    ],
    note: QMDF_NOTE,
  },
  {
    id: 'qmdf_abc093', name: 'ABC_093', res: '256³', ours: 'χ = −3', patches: true,
    methods: [
      { id: 'gt', name: 'Input mesh', stat: 'χ = −6' },
      { id: 'dcudf', name: 'DCUDF', stat: 'χ = −6' },
      { id: 'mind', name: 'MIND', stat: 'χ = −19' },
    ],
    note: QMDF_NOTE,
  },
]

export const GROUPS: Group[] = [
  {
    id: 'udf', name: 'UDF benchmarks',
    subgroups: [{ name: '', sets: UDF_SETS }],
  },
  {
    id: 'features', name: 'Sharp & non-manifold',
    subgroups: [
      { name: 'Sharp edges', sets: SHARP_SETS },
      { name: 'Non-manifold', sets: NM_SETS },
    ],
  },
  {
    id: 'qmdf', name: 'Q-MDF',
    subgroups: [
      { name: 'Organic', sets: QMDF_ORGANIC },
      { name: 'CAD', sets: QMDF_CAD },
    ],
  },
]
