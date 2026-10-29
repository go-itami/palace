import copy
import json
import sys
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from exporter import SceneError, files_for_scene, generate_config, generate_geo, validate, zip_files


def scene():
    return {"name": "Cavity", "unit": "mm", "objects": [{"id": "s1", "name": "Cylinder1", "type": "cylinder", "position": [0, 0, 0], "dimensions": {"radius": 27.4, "height": 54.8}, "material": {"name": "Teflon", "eps": 2.08, "mu": 1.0, "loss": 0.0004}}], "boundary": {"type": "PEC", "rs": 0.0184}, "analysis": {"type": "Eigenmode", "target": 2.0, "order": 4, "modes": 15, "tol": 1e-7, "meshSize": 6, "save": 3, "amr": 0}}


class TestExporter(unittest.TestCase):
    def test_palace_schema(self):
        s=validate(scene())
        config=generate_config(s)
        self.assertEqual(set(config), {"Problem", "Model", "Domains", "Boundaries", "Solver"})
        self.assertEqual(config["Model"]["L0"],1e-3)
        self.assertEqual(config["Domains"]["Materials"][0]["Permittivity"],2.08)
        self.assertEqual(config["Solver"]["Eigenmode"]["Target"],2)
        self.assertEqual(config["Solver"]["Order"],4)
        self.assertEqual(config["Boundaries"]["PEC"]["Attributes"],[2])
        self.assertEqual(config["Model"]["Mesh"], 'mesh.msh')

    def test_geo_validity(self):
        geo=generate_geo(validate(scene()))
        self.assertIn('Cylinder(1) = {0, 0, -27.4, 0, 0, 54.8, 27.4, 2*Pi};',geo)
        self.assertIn('Physical Surface("outer", 2)',geo)
        self.assertIn('Mesh.MshFileVersion = 2.2;',geo)

    def test_shapes(self):
        for shape,dim in [('box',{'width':10,'depth':20,'height':30}),('sphere',{'radius':15})]:
            s=scene();s['objects'][0]['type']=shape;s['objects'][0]['dimensions']=dim
            geo=generate_geo(validate(s))
            self.assertIn('Box(1)' if shape=='box' else 'Sphere(1)',geo)

    def test_impedance(self):
        s=scene();s['boundary']['type']='Impedance'
        config=generate_config(validate(s))
        self.assertEqual(config['Boundaries']['Impedance'][0]['Rs'], .0184)

    def test_reject_nonfinite_and_injection(self):
        s=scene();s['objects'][0]['dimensions']['radius']='NaN'
        with self.assertRaises(SceneError): validate(s)
        s=scene();s['objects'][0]['dimensions']['radius']='0; System("whoami")'
        with self.assertRaises(SceneError): validate(s)

    def test_reject_multibody(self):
        s=scene();s['objects'].append(copy.deepcopy(s['objects'][0]))
        with self.assertRaisesRegex(SceneError,'exactly one'): validate(s)

    def test_bundle(self):
        files=files_for_scene(scene());self.assertEqual(set(files),{'scene.json','config.json','model.geo','run.sh','README.txt'})
        with zipfile.ZipFile(BytesIO(zip_files(files))) as z:
            config=json.loads(z.read('config.json'))
            self.assertEqual(config['Problem']['Type'],'Eigenmode')
            self.assertIn('gmsh -3 model.geo',z.read('run.sh').decode())

    def test_unit_scale(self):
        s=scene();s['unit']='cm'
        self.assertEqual(generate_config(validate(s))['Model']['L0'], 1e-2)

if __name__ == '__main__': unittest.main()
