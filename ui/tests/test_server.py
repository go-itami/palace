import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import parse_eigen_csv

class TestCsv(unittest.TestCase):
    def test_palace_eigen_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'eig.csv'
            p.write_text('m,Re{f} (GHz),Im{f} (GHz),Q,Error (Bkwd.)\n1.00e+00,2.904769618774,5.8e-4,2.500000146549e+03,1e-12\n2,2.922855211084,5.8e-4,2.5e3,1e-12\n')
            data=parse_eigen_csv(p)
            self.assertEqual(len(data),2)
            self.assertEqual(data[0]['mode'],1)
            self.assertAlmostEqual(data[0]['frequencyGHz'],2.904769618774)
            self.assertAlmostEqual(data[0]['q'],2500.000146549)
    def test_missing(self):
        self.assertEqual(parse_eigen_csv(Path('/impossible/cannot/exist/eig.csv')),[])

if __name__=='__main__':unittest.main()
