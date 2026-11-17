using System.Windows;
using System.Windows.Media;
using Color = System.Windows.Media.Color;
using Point = System.Windows.Point;

namespace RevitMCP.FamilyLibrary {
 public static class RibbonIcon {
  public static ImageSource Create() {
   var drawing=new DrawingGroup();
   using(var dc=drawing.Open()) {
    dc.DrawRectangle(Brushes.Transparent,null,new Rect(0,0,32,32));
    dc.DrawRoundedRectangle(new SolidColorBrush(Color.FromRgb(237,244,240)),null,new Rect(1,1,30,30),6,6);
    dc.DrawGeometry(new SolidColorBrush(Color.FromRgb(58,139,111)),null,Geometry.Parse("M16,5 L26,10.5 16,16 6,10.5 Z"));
    dc.DrawGeometry(new SolidColorBrush(Color.FromRgb(36,68,78)),null,Geometry.Parse("M6,10.5 L16,16 16,27 6,21.5 Z"));
    dc.DrawGeometry(new SolidColorBrush(Color.FromRgb(39,104,88)),null,Geometry.Parse("M16,16 L26,10.5 26,21.5 16,27 Z"));
    var edge=new Pen(new SolidColorBrush(Color.FromArgb(190,239,249,243)),0.8);
    dc.DrawLine(edge,new Point(16,16),new Point(16,27));
    dc.DrawLine(edge,new Point(6,10.5),new Point(16,16));
    dc.DrawLine(edge,new Point(16,16),new Point(26,10.5));
    var detail=new Pen(new SolidColorBrush(Color.FromArgb(170,212,238,225)),0.8);
    dc.DrawLine(detail,new Point(19.4,17.7),new Point(23.4,15.5));
    dc.DrawLine(detail,new Point(19.4,21),new Point(23.4,18.8));
   }
   drawing.Freeze();var image=new DrawingImage(drawing);image.Freeze();return image;
  }
 }
}
